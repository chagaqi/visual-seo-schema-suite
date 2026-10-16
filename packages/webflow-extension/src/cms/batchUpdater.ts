import {
  HttpError,
  RateLimiter,
  abortError,
  parseRetryAfter,
  withRetry,
  type RetryOptions,
  type Sleep,
} from "@vss/core-engine"

/**
 * Throttled, fault-tolerant batch updater for the Webflow v2 Data API.
 *
 * Why this exists: bulk CMS edits from competing plugins crash on HTTP 429. This runner
 *  - sends at most `ratePerMinute` requests (token bucket, adapted live from X-RateLimit-* headers),
 *  - pauses *all* traffic for Retry-After seconds when a 429 arrives, then retries with
 *    exponential backoff + jitter,
 *  - retries 5xx/network errors,
 *  - bisects a chunk on 400/422 so one invalid item doesn't sink the other 99,
 *  - reports progress per item and supports cancellation.
 */

export interface BatchResponse {
  status: number
  headers: Headers
  body: unknown
}

export interface BatchUpdaterOptions<T> {
  items: T[]
  /** Webflow bulk endpoints accept up to 100 items per request. */
  chunkSize?: number
  /** Send one chunk; must resolve with the raw response (don't throw on HTTP errors). */
  send: (chunk: T[], attempt: number) => Promise<BatchResponse>
  itemId: (item: T) => string
  /** Starting rate; Webflow plans allow 60 (Starter/Basic) or 120 (CMS/Business) requests per minute. */
  ratePerMinute?: number
  limiter?: RateLimiter
  retry?: Pick<RetryOptions, "retries" | "baseDelayMs" | "maxDelayMs" | "jitter" | "random">
  onProgress?: (done: number, total: number) => void
  onRateLimited?: (info: { retryAfterMs: number; attempt: number }) => void
  signal?: AbortSignal
  sleep?: Sleep
  now?: () => number
}

export interface BatchResult {
  updated: number
  failed: Array<{ id: string; error: string }>
  requests: number
  rateLimitHits: number
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as { message?: string; msg?: string; code?: string; details?: unknown[] }
    const detail = Array.isArray(b.details) && b.details.length ? ` (${JSON.stringify(b.details[0])})` : ""
    if (b.message || b.msg) return `${b.message ?? b.msg}${detail}`
  }
  return `HTTP ${status}`
}

export async function runBatchUpdate<T>(options: BatchUpdaterOptions<T>): Promise<BatchResult> {
  const {
    items,
    chunkSize = 100,
    send,
    itemId,
    ratePerMinute = 60,
    retry = {},
    onProgress,
    onRateLimited,
    signal,
    sleep,
    now,
  } = options
  const limiter =
    options.limiter ??
    new RateLimiter({
      tokensPerInterval: ratePerMinute,
      intervalMs: 60_000,
      // Small burst so the first chunks go out immediately without tripping the server limiter.
      capacity: Math.min(ratePerMinute, 10),
      ...(now ? { now } : {}),
      ...(sleep ? { sleep } : {}),
    })

  const result: BatchResult = { updated: 0, failed: [], requests: 0, rateLimitHits: 0 }
  let done = 0
  const tick = (n: number) => {
    done += n
    onProgress?.(done, items.length)
  }

  const sendChunk = async (chunk: T[]): Promise<void> => {
    if (signal?.aborted) {
      result.failed.push(...chunk.map((i) => ({ id: itemId(i), error: "Cancelled" })))
      tick(chunk.length)
      return
    }
    let clientError: { status: number; message: string } | null = null
    try {
      await withRetry(
        async (attempt) => {
          await limiter.acquire(signal)
          result.requests++
          const res = await send(chunk, attempt)
          const limit = Number(res.headers.get("x-ratelimit-limit"))
          const remaining = res.headers.get("x-ratelimit-remaining")
          limiter.update({ limit: Number.isFinite(limit) && limit > 0 ? limit : null, remaining: remaining === null ? null : Number(remaining) })
          if (res.status === 429) {
            result.rateLimitHits++
            const retryAfterMs = parseRetryAfter(res.headers) ?? 60_000
            limiter.pauseFor(retryAfterMs)
            onRateLimited?.({ retryAfterMs, attempt })
            throw new HttpError(429, "Rate limited", { retryAfterMs, body: res.body })
          }
          if (res.status >= 500) throw new HttpError(res.status, errorMessage(res.body, res.status), { body: res.body })
          if (res.status >= 400) {
            clientError = { status: res.status, message: errorMessage(res.body, res.status) }
            return
          }
        },
        {
          retries: 8,
          baseDelayMs: 1000,
          maxDelayMs: 60_000,
          ...retry,
          ...(signal ? { signal } : {}),
          ...(sleep ? { sleep } : {}),
        },
      )
    } catch (error) {
      if (signal?.aborted) {
        result.failed.push(...chunk.map((i) => ({ id: itemId(i), error: "Cancelled" })))
        tick(chunk.length)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      result.failed.push(...chunk.map((i) => ({ id: itemId(i), error: message })))
      tick(chunk.length)
      return
    }

    const ce = clientError as { status: number; message: string } | null
    if (ce) {
      // Validation errors: split the chunk to find the offending item(s).
      if (chunk.length > 1 && (ce.status === 400 || ce.status === 422)) {
        const mid = Math.ceil(chunk.length / 2)
        await sendChunk(chunk.slice(0, mid))
        await sendChunk(chunk.slice(mid))
        return
      }
      result.failed.push(...chunk.map((i) => ({ id: itemId(i), error: ce.message })))
      tick(chunk.length)
      return
    }
    result.updated += chunk.length
    tick(chunk.length)
  }

  for (let i = 0; i < items.length; i += chunkSize) {
    if (signal?.aborted && i === 0) throw abortError(signal)
    await sendChunk(items.slice(i, i + chunkSize))
  }
  return result
}
