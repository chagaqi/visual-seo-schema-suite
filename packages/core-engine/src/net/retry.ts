/**
 * Exponential backoff with full jitter, Retry-After awareness and injectable clock — the piece that
 * keeps bulk CMS updates from crashing on HTTP 429.
 */

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>

export const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal))
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal!))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })

export function abortError(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  const err = new Error(typeof reason === "string" ? reason : "The operation was aborted")
  err.name = "AbortError"
  return err
}

/** Error carrying an HTTP status and (optionally) the server's retry hint. */
export class HttpError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null
  readonly body: unknown
  constructor(status: number, message: string, options: { retryAfterMs?: number | null; body?: unknown } = {}) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.retryAfterMs = options.retryAfterMs ?? null
    this.body = options.body
  }
}

/**
 * Parse `Retry-After` (delta-seconds or HTTP-date) and the common `X-RateLimit-Reset` /
 * `RateLimit-Reset` headers into milliseconds to wait. Returns null when absent/unparseable.
 */
export function parseRetryAfter(headers: Headers | Record<string, string | null | undefined>, now = Date.now()): number | null {
  const get = (name: string): string | null => {
    if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name)
    const rec = headers as Record<string, string | null | undefined>
    const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? (rec[key] ?? null) : null
  }
  const retryAfter = get("retry-after")
  if (retryAfter) {
    const trimmed = retryAfter.trim()
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(0, Math.round(parseFloat(trimmed) * 1000))
    const date = Date.parse(trimmed)
    if (!Number.isNaN(date)) return Math.max(0, date - now)
  }
  const reset = get("x-ratelimit-reset") ?? get("ratelimit-reset")
  if (reset && /^\d+(\.\d+)?$/.test(reset.trim())) {
    const n = parseFloat(reset)
    // Epoch seconds vs. delta seconds: anything that looks like a timestamp is absolute.
    if (n > 1_000_000_000) return Math.max(0, Math.round(n * 1000 - now))
    return Math.max(0, Math.round(n * 1000))
  }
  return null
}

export interface RetryOptions {
  /** Max retries after the first attempt. */
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** "full" jitter (AWS style) by default; "none" for deterministic tests. */
  jitter?: "full" | "equal" | "none"
  /** Decide whether an error is retryable. Defaults to 408/425/429/5xx and network errors. */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void
  signal?: AbortSignal
  sleep?: Sleep
  random?: () => number
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500
  if (error instanceof Error && error.name === "AbortError") return false
  // fetch() network failures surface as TypeError.
  return error instanceof TypeError
}

/** Compute the backoff delay for a given attempt (0-based). */
export function backoffDelay(
  attempt: number,
  { baseDelayMs = 500, maxDelayMs = 30_000, jitter = "full", random = Math.random }: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "jitter" | "random"> = {},
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
  if (jitter === "none") return exp
  if (jitter === "equal") return Math.round(exp / 2 + random() * (exp / 2))
  return Math.round(random() * exp)
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 5,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    jitter = "full",
    shouldRetry = isRetryableError,
    onRetry,
    signal,
    sleep = defaultSleep,
    random = Math.random,
  } = options

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError(signal)
    try {
      return await fn(attempt)
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error, attempt)) throw error
      let delayMs = backoffDelay(attempt, { baseDelayMs, maxDelayMs, jitter, random })
      // The server knows best: never retry sooner than Retry-After says.
      if (error instanceof HttpError && error.retryAfterMs !== null) {
        delayMs = Math.min(Math.max(delayMs, error.retryAfterMs), Math.max(maxDelayMs, error.retryAfterMs))
      }
      onRetry?.({ attempt: attempt + 1, delayMs, error })
      await sleep(delayMs, signal)
    }
  }
}
