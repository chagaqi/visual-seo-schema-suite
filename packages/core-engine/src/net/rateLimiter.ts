import { abortError, defaultSleep, type Sleep } from "./retry.ts"

export interface RateLimiterOptions {
  /** Requests allowed per interval (Webflow CMS/Starter plans: 60 per minute). */
  tokensPerInterval: number
  intervalMs: number
  /** Burst capacity; defaults to tokensPerInterval. */
  capacity?: number
  now?: () => number
  sleep?: Sleep
}

/**
 * Token-bucket rate limiter. `acquire()` resolves when a request may be sent; callers queue FIFO.
 * The bucket can be re-tuned at runtime from response headers (`X-RateLimit-Limit/Remaining`).
 */
export class RateLimiter {
  private tokens: number
  private lastRefill: number
  private capacity: number
  private tokensPerInterval: number
  private intervalMs: number
  private readonly now: () => number
  private readonly sleep: Sleep
  private queue: Promise<void> = Promise.resolve()
  private pausedUntil = 0

  constructor(options: RateLimiterOptions) {
    this.tokensPerInterval = options.tokensPerInterval
    this.intervalMs = options.intervalMs
    this.capacity = options.capacity ?? options.tokensPerInterval
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.tokens = this.capacity
    this.lastRefill = this.now()
  }

  private refill(): void {
    const now = this.now()
    const elapsed = now - this.lastRefill
    if (elapsed <= 0) return
    const add = (elapsed / this.intervalMs) * this.tokensPerInterval
    this.tokens = Math.min(this.capacity, this.tokens + add)
    this.lastRefill = now
  }

  /** Current (fractional) token count, for diagnostics/tests. */
  available(): number {
    this.refill()
    return this.tokens
  }

  /** Block all callers until `ms` from now (e.g. after a 429 with Retry-After). */
  pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms)
    this.tokens = Math.min(this.tokens, 0)
  }

  /** Adapt to the server's advertised limits. */
  update({ limit, remaining }: { limit?: number | null; remaining?: number | null }): void {
    this.refill()
    if (limit && limit > 0 && limit !== this.tokensPerInterval) {
      this.tokensPerInterval = limit
      this.capacity = limit
    }
    if (remaining !== null && remaining !== undefined && remaining >= 0) this.tokens = Math.min(this.tokens, remaining)
  }

  acquire(signal?: AbortSignal): Promise<void> {
    const run = async () => {
      for (;;) {
        if (signal?.aborted) throw abortError(signal)
        const now = this.now()
        if (this.pausedUntil > now) {
          await this.sleep(this.pausedUntil - now, signal)
          continue
        }
        this.refill()
        if (this.tokens >= 1) {
          this.tokens -= 1
          return
        }
        const waitMs = Math.ceil(((1 - this.tokens) / this.tokensPerInterval) * this.intervalMs)
        await this.sleep(Math.max(1, waitMs), signal)
      }
    }
    const next = this.queue.then(run, run)
    // Keep the chain alive even if one waiter aborts.
    this.queue = next.catch(() => undefined)
    return next
  }
}

/** Run async tasks with bounded concurrency, preserving result order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      if (signal?.aborted) throw abortError(signal)
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}
