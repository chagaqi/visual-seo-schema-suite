import { describe, expect, it } from "vitest"
import { RateLimiter } from "@vss/core-engine"
import { runBatchUpdate, type BatchResponse } from "../src/cms/batchUpdater.ts"
import { WebflowCmsClient } from "../src/cms/webflowCmsClient.ts"
import { createFakeDataApi } from "../src/testing/fakeWebflow.ts"

/** Virtual clock shared by the limiter, retry sleeps and the fake API's rate window. */
function clock() {
  let t = 1_700_000_000_000
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
    sleeps,
  }
}

const ok = (): BatchResponse => ({ status: 200, headers: new Headers(), body: {} })

describe("runBatchUpdate", () => {
  it("chunks items into ≤100 per request and reports progress", async () => {
    const c = clock()
    const sizes: number[] = []
    const progress: number[] = []
    const items = Array.from({ length: 250 }, (_, i) => ({ id: `i${i}` }))
    const res = await runBatchUpdate({
      items,
      itemId: (i) => i.id,
      send: async (chunk) => {
        sizes.push(chunk.length)
        return ok()
      },
      onProgress: (d) => progress.push(d),
      sleep: c.sleep,
      now: c.now,
    })
    expect(sizes).toEqual([100, 100, 50])
    expect(progress).toEqual([100, 200, 250])
    expect(res).toMatchObject({ updated: 250, failed: [], requests: 3, rateLimitHits: 0 })
  })

  it("survives a 429 storm: pauses for Retry-After then completes without dropping items", async () => {
    const c = clock()
    let calls = 0
    const rateLimited: number[] = []
    const res = await runBatchUpdate({
      items: Array.from({ length: 300 }, (_, i) => ({ id: `i${i}` })),
      chunkSize: 100,
      itemId: (i) => i.id,
      send: async () => {
        calls++
        if (calls <= 3) return { status: 429, headers: new Headers({ "retry-after": "7" }), body: { message: "Too many requests" } }
        return ok()
      },
      onRateLimited: ({ retryAfterMs }) => rateLimited.push(retryAfterMs),
      retry: { jitter: "none", baseDelayMs: 500 },
      sleep: c.sleep,
      now: c.now,
    })
    expect(res.updated).toBe(300)
    expect(res.failed).toEqual([])
    expect(res.rateLimitHits).toBe(3)
    expect(rateLimited).toEqual([7000, 7000, 7000])
    // Never retried sooner than the server asked.
    expect(c.sleeps.filter((s) => s >= 7000).length).toBeGreaterThanOrEqual(3)
  })

  it("retries 5xx and network errors with exponential backoff", async () => {
    const c = clock()
    let calls = 0
    const res = await runBatchUpdate({
      items: [{ id: "a" }],
      itemId: (i) => i.id,
      send: async () => {
        calls++
        if (calls === 1) throw new TypeError("Failed to fetch")
        if (calls === 2) return { status: 503, headers: new Headers(), body: {} }
        return ok()
      },
      retry: { jitter: "none", baseDelayMs: 100 },
      sleep: c.sleep,
      now: c.now,
    })
    expect(res.updated).toBe(1)
    expect(c.sleeps).toEqual([100, 200])
  })

  it("bisects a chunk on 400 to isolate invalid items", async () => {
    const c = clock()
    const bad = new Set(["i3", "i7"])
    const res = await runBatchUpdate({
      items: Array.from({ length: 10 }, (_, i) => ({ id: `i${i}` })),
      itemId: (i) => i.id,
      send: async (chunk) =>
        chunk.some((i) => bad.has(i.id)) ? { status: 400, headers: new Headers(), body: { message: "Validation Error" } } : ok(),
      sleep: c.sleep,
      now: c.now,
    })
    expect(res.updated).toBe(8)
    expect(res.failed.map((f) => f.id).sort()).toEqual(["i3", "i7"])
    expect(res.failed[0]!.error).toBe("Validation Error")
  })

  it("fails a chunk on non-retryable auth errors without retrying", async () => {
    const c = clock()
    let calls = 0
    const res = await runBatchUpdate({
      items: [{ id: "a" }, { id: "b" }],
      itemId: (i) => i.id,
      send: async () => {
        calls++
        return { status: 401, headers: new Headers(), body: { message: "Invalid token" } }
      },
      sleep: c.sleep,
      now: c.now,
    })
    expect(calls).toBe(1)
    expect(res.failed).toEqual([
      { id: "a", error: "Invalid token" },
      { id: "b", error: "Invalid token" },
    ])
  })

  it("marks remaining items cancelled when aborted mid-run", async () => {
    const c = clock()
    const controller = new AbortController()
    const res = await runBatchUpdate({
      items: Array.from({ length: 300 }, (_, i) => ({ id: `i${i}` })),
      itemId: (i) => i.id,
      send: async () => {
        controller.abort()
        return ok()
      },
      signal: controller.signal,
      sleep: c.sleep,
      now: c.now,
    })
    expect(res.updated).toBe(100)
    expect(res.failed).toHaveLength(200)
    expect(res.failed.every((f) => f.error === "Cancelled")).toBe(true)
  })

  it("adapts the limiter to X-RateLimit headers", async () => {
    const c = clock()
    const limiter = new RateLimiter({ tokensPerInterval: 60, intervalMs: 60_000, now: c.now, sleep: c.sleep })
    await runBatchUpdate({
      items: [{ id: "a" }],
      itemId: (i) => i.id,
      limiter,
      send: async () => ({ status: 200, headers: new Headers({ "x-ratelimit-limit": "120", "x-ratelimit-remaining": "0" }), body: {} }),
      sleep: c.sleep,
      now: c.now,
    })
    expect(limiter.available()).toBe(0)
  })
})

describe("WebflowCmsClient against a rate-limited fake Data API", () => {
  it("paginates items and bulk-updates 250 items under a 60 rpm limit with zero failures", async () => {
    const c = clock()
    const api = createFakeDataApi({ limitPerWindow: 4, now: c.now })
    const client = new WebflowCmsClient({ token: "test-token", fetch: api.fetch, sleep: c.sleep, now: c.now, ratePerMinute: 60 })

    const collections = await client.listCollections("site-123")
    expect(collections.map((x) => x.displayName)).toEqual(["Cabins"])
    const items = await client.listItems("col-1")
    expect(items).toHaveLength(250)

    const updates = items.map((i) => ({ id: i.id, fieldData: { "seo-description": `${i.fieldData.name} — lakeside cabin with wood stove.` } }))
    const res = await client.updateItems("col-1", updates)
    expect(res.updated).toBe(250)
    expect(res.failed).toEqual([])
    expect(api.items.every((i) => String(i.fieldData["seo-description"]).includes("lakeside"))).toBe(true)
    // The fake allowed only 4 requests per minute: we must have been throttled and recovered.
    expect(api.calls.some((call) => call.status === 429)).toBe(true)
    expect(api.calls.filter((call) => call.method === "PATCH" && call.status === 200)).toHaveLength(3)
  })

  it("surfaces auth errors from reads", async () => {
    const api = createFakeDataApi()
    const client = new WebflowCmsClient({ token: "wrong", fetch: api.fetch })
    await expect(client.listCollections("s")).rejects.toThrow(/Invalid token/)
  })

  it("refuses inline head scripts over Webflow's 2000 character limit", async () => {
    const api = createFakeDataApi()
    const client = new WebflowCmsClient({ token: "test-token", fetch: api.fetch })
    await expect(client.upsertHeadScript({ siteId: "s", sourceCode: "x".repeat(2001), displayName: "x", version: "1" })).rejects.toThrow(/2000/)
  })
})
