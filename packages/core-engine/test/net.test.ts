import { describe, expect, it, vi } from "vitest"
import {
  HttpError,
  LicenseClient,
  RateLimiter,
  backoffDelay,
  isRetryableError,
  mapWithConcurrency,
  memoryStore,
  parseRetryAfter,
  withRetry,
} from "../src/index.ts"

/** Virtual clock: sleep advances time instantly. */
function virtualClock(start = 0) {
  let now = start
  const sleeps: number[] = []
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      now += ms
    },
    sleeps,
  }
}

describe("parseRetryAfter", () => {
  it("parses seconds, HTTP dates and reset headers", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "2" }))).toBe(2000)
    const now = Date.parse("2026-10-16T00:00:00Z")
    expect(parseRetryAfter({ "Retry-After": "Fri, 16 Oct 2026 00:00:05 GMT" }, now)).toBe(5000)
    expect(parseRetryAfter({ "X-RateLimit-Reset": String(now / 1000 + 10) }, now)).toBe(10000)
    expect(parseRetryAfter({ "x-ratelimit-reset": "3" }, now)).toBe(3000)
    expect(parseRetryAfter(new Headers())).toBeNull()
  })
})

describe("withRetry", () => {
  it("retries retryable errors with exponential backoff", async () => {
    const clock = virtualClock()
    let calls = 0
    const result = await withRetry(
      async () => {
        calls++
        if (calls < 4) throw new HttpError(503, "unavailable")
        return "ok"
      },
      { sleep: clock.sleep, jitter: "none", baseDelayMs: 100 },
    )
    expect(result).toBe("ok")
    expect(clock.sleeps).toEqual([100, 200, 400])
  })

  it("honours Retry-After on 429 even when backoff is shorter", async () => {
    const clock = virtualClock()
    let calls = 0
    await withRetry(
      async () => {
        if (calls++ === 0) throw new HttpError(429, "slow down", { retryAfterMs: 7000 })
        return 1
      },
      { sleep: clock.sleep, jitter: "none", baseDelayMs: 100 },
    )
    expect(clock.sleeps).toEqual([7000])
  })

  it("does not retry 4xx client errors and gives up after max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(400, "bad"))
    await expect(withRetry(fn, { sleep: async () => {} })).rejects.toThrow("bad")
    expect(fn).toHaveBeenCalledTimes(1)
    const fn2 = vi.fn().mockRejectedValue(new HttpError(500, "boom"))
    await expect(withRetry(fn2, { retries: 2, sleep: async () => {} })).rejects.toThrow("boom")
    expect(fn2).toHaveBeenCalledTimes(3)
  })

  it("stops on abort", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(withRetry(async () => 1, { signal: controller.signal })).rejects.toThrow(/abort/i)
  })

  it("classifies errors and computes jittered delays within bounds", () => {
    expect(isRetryableError(new HttpError(429, ""))).toBe(true)
    expect(isRetryableError(new HttpError(404, ""))).toBe(false)
    expect(isRetryableError(new TypeError("Failed to fetch"))).toBe(true)
    for (let i = 0; i < 20; i++) {
      const d = backoffDelay(3, { baseDelayMs: 100 })
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(800)
    }
    expect(backoffDelay(20, { baseDelayMs: 100, maxDelayMs: 1000, jitter: "none" })).toBe(1000)
  })
})

describe("RateLimiter", () => {
  it("allows a burst then spaces requests to the configured rate", async () => {
    const clock = virtualClock()
    const limiter = new RateLimiter({ tokensPerInterval: 60, intervalMs: 60_000, capacity: 2, now: clock.now, sleep: clock.sleep })
    const times: number[] = []
    for (let i = 0; i < 5; i++) {
      await limiter.acquire()
      times.push(clock.now())
    }
    expect(times.slice(0, 2)).toEqual([0, 0])
    // One token per second afterwards.
    expect(times[2]).toBe(1000)
    expect(times[4]).toBe(3000)
  })

  it("pauses everyone after a 429 and adapts to server limits", async () => {
    const clock = virtualClock()
    const limiter = new RateLimiter({ tokensPerInterval: 10, intervalMs: 1000, now: clock.now, sleep: clock.sleep })
    limiter.pauseFor(5000)
    await limiter.acquire()
    expect(clock.now()).toBeGreaterThanOrEqual(5000)
    limiter.update({ limit: 120, remaining: 0 })
    expect(limiter.available()).toBe(0)
  })

  it("serves waiters FIFO", async () => {
    const clock = virtualClock()
    const limiter = new RateLimiter({ tokensPerInterval: 1, intervalMs: 100, capacity: 1, now: clock.now, sleep: clock.sleep })
    const order: number[] = []
    await Promise.all([1, 2, 3].map((n) => limiter.acquire().then(() => order.push(n))))
    expect(order).toEqual([1, 2, 3])
  })
})

describe("mapWithConcurrency", () => {
  it("bounds concurrency and preserves order", async () => {
    let active = 0
    let peak = 0
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12])
    expect(peak).toBe(2)
  })
})

describe("LicenseClient", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

  it("consumes credits through the worker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { plan: "free", allowed: true, remaining: 9, limit: 10, used: 1 }))
    const client = new LicenseClient({ baseUrl: "https://lic.test/", host: "framer", getUserId: async () => "u1", storage: memoryStore(), fetch: fetchMock })
    const status = await client.consume("alt-text")
    expect(status.remaining).toBe(9)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://lic.test/v1/usage/consume")
    expect(JSON.parse(init.body)).toEqual({ userId: "u1", host: "framer", feature: "alt-text", licenseKey: null })
  })

  it("returns the 402 body when the quota is exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(402, { plan: "free", allowed: false, remaining: 0, limit: 10, used: 10, checkoutUrl: "https://polar.sh/x" }))
    const client = new LicenseClient({ baseUrl: "https://lic.test", host: "webflow", getUserId: async () => "u", storage: memoryStore(), fetch: fetchMock })
    const status = await client.consume("audit")
    expect(status.allowed).toBe(false)
    expect(status.checkoutUrl).toBe("https://polar.sh/x")
  })

  it("falls back to a local counter when offline", async () => {
    const storage = memoryStore()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    const client = new LicenseClient({ baseUrl: "https://lic.test", host: "framer", getUserId: async () => "u", storage, fetch: fetchMock, freeLimit: 2 })
    expect((await client.consume("meta")).allowed).toBe(true)
    expect((await client.consume("meta")).allowed).toBe(true)
    const third = await client.consume("meta")
    expect(third.allowed).toBe(false)
    expect(third.offline).toBe(true)
    expect((await client.status()).remaining).toBe(0)
  })

  it("stores the license key only when valid", async () => {
    const storage = memoryStore()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { valid: false, plan: "free", message: "Invalid key" }))
      .mockResolvedValueOnce(json(200, { valid: true, plan: "pro", status: "granted" }))
    const client = new LicenseClient({ baseUrl: "https://lic.test", host: "framer", getUserId: async () => "u", storage, fetch: fetchMock })
    expect((await client.activate("bad")).valid).toBe(false)
    expect(await client.getLicenseKey()).toBeNull()
    expect((await client.activate(" GOOD-KEY ")).plan).toBe("pro")
    expect(await client.getLicenseKey()).toBe("GOOD-KEY")
  })
})
