import { describe, expect, it, vi } from "vitest"
import { createApp, type Env } from "../src/app.ts"

/** Minimal in-memory KVNamespace (get text/json, put with TTL, delete). */
function memoryKV() {
  const store = new Map<string, string>()
  const kv = {
    store,
    async get(key: string, type?: "text" | "json") {
      const v = store.get(key)
      if (v === undefined) return null
      return type === "json" ? JSON.parse(v) : v
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
  return kv
}

function makeEnv(overrides: Partial<Env> = {}): Env & { USAGE: ReturnType<typeof memoryKV> } {
  return {
    USAGE: memoryKV() as unknown as KVNamespace & ReturnType<typeof memoryKV>,
    POLAR_ORGANIZATION_ID: "org_123",
    POLAR_ACCESS_TOKEN: "polar_oat_test",
    CHECKOUT_URL: "https://polar.sh/acme/products/pro",
    FREE_LIMIT: "10",
    ...overrides,
  } as Env & { USAGE: ReturnType<typeof memoryKV> }
}

function polarMock(byKey: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u.includes("polar")) {
      const { key } = JSON.parse(String(init?.body)) as { key: string }
      const r = byKey[key] ?? { status: 404, body: { detail: "Not found" } }
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } })
    }
    return new Response(JSON.stringify({ upstream: u, method: init?.method }), {
      status: 200,
      headers: { "content-type": "application/json", "x-ratelimit-remaining": "59", "x-ratelimit-limit": "60", "x-other": "hidden" },
    })
  })
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4", ...headers },
  body: JSON.stringify(body),
})

describe("license worker", () => {
  it("responds to health checks", async () => {
    const app = createApp()
    const res = await app.request("/health", {}, makeEnv())
    expect(await res.json()).toEqual({ ok: true, service: "vss-license-worker" })
  })

  it("grants exactly 10 free generations per user, then returns 402 with checkout URL", async () => {
    const env = makeEnv()
    const app = createApp({ fetch: polarMock({}) })
    const statuses: number[] = []
    let last: Record<string, unknown> = {}
    for (let i = 0; i < 11; i++) {
      const res = await app.request("/v1/usage/consume", post({ userId: "user-a", host: "framer", feature: "alt-text" }), env)
      statuses.push(res.status)
      last = (await res.json()) as Record<string, unknown>
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses[10]).toBe(402)
    expect(last).toMatchObject({ plan: "free", allowed: false, remaining: 0, limit: 10, used: 10, checkoutUrl: "https://polar.sh/acme/products/pro" })

    const status = await app.request("/v1/usage/status", post({ userId: "user-a", host: "framer" }), env)
    expect(await status.json()).toMatchObject({ allowed: false, remaining: 0 })
  })

  it("meters users and hosts independently and stores hashed ids", async () => {
    const env = makeEnv()
    const app = createApp({ fetch: polarMock({}) })
    await app.request("/v1/usage/consume", post({ userId: "user-a", host: "framer", feature: "meta" }), env)
    const other = await app.request("/v1/usage/consume", post({ userId: "user-a", host: "webflow", feature: "meta" }), env)
    expect(await other.json()).toMatchObject({ remaining: 9 })
    expect([...env.USAGE.store.keys()].some((k) => k.includes("user-a"))).toBe(false)
  })

  it("validates Polar license keys (granted/revoked/expired/not found) and caches verdicts", async () => {
    const fetchMock = polarMock({
      "GOOD-KEY": { status: 200, body: { status: "granted", expires_at: null } },
      "REVOKED-KEY": { status: 200, body: { status: "revoked", expires_at: null } },
      "OLD-KEY": { status: 200, body: { status: "granted", expires_at: "2020-01-01T00:00:00Z" } },
    })
    const env = makeEnv()
    const app = createApp({ fetch: fetchMock })
    const check = async (key: string) => (await app.request("/v1/license/validate", post({ key, userId: "u", host: "framer" }), env)).json()
    expect(await check("GOOD-KEY")).toMatchObject({ valid: true, plan: "pro", status: "granted" })
    expect(await check("REVOKED-KEY")).toMatchObject({ valid: false, status: "revoked" })
    expect(await check("OLD-KEY")).toMatchObject({ valid: false, status: "expired" })
    expect(await check("NOPE-KEY")).toMatchObject({ valid: false, status: "not_found" })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("https://api.polar.sh/v1/license-keys/validate")
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer polar_oat_test")
    expect(JSON.parse(String(init!.body))).toEqual({ key: "GOOD-KEY", organization_id: "org_123" })
  })

  it("uses the public customer-portal endpoint when no access token is configured", async () => {
    const fetchMock = polarMock({ K1234: { status: 200, body: { id: "lk_1" } } })
    const app = createApp({ fetch: fetchMock })
    const res = await app.request("/v1/license/validate", post({ key: "K1234" }), makeEnv({ POLAR_ACCESS_TOKEN: undefined, POLAR_API_BASE: "https://sandbox-api.polar.sh" }))
    expect(await res.json()).toMatchObject({ valid: true })
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://sandbox-api.polar.sh/v1/customer-portal/license-keys/validate")
  })

  it("lets Pro users through without limits and caches the Polar check", async () => {
    const fetchMock = polarMock({ "GOOD-KEY": { status: 200, body: { status: "granted" } } })
    const env = makeEnv({ FREE_LIMIT: "1" })
    const app = createApp({ fetch: fetchMock })
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/v1/usage/consume", post({ userId: "pro-user", host: "webflow", feature: "cms-bulk", licenseKey: "GOOD-KEY" }), env)
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ plan: "pro", allowed: true, remaining: null })
    }
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("polar"))).toHaveLength(1)
  })

  it("keeps Pro users working through a Polar outage using the cached verdict", async () => {
    let up = true
    const fetchMock = vi.fn(async () => {
      if (!up) throw new TypeError("network down")
      return new Response(JSON.stringify({ status: "granted" }), { status: 200 })
    })
    let t = 1_000_000
    const env = makeEnv({ FREE_LIMIT: "0" })
    const app = createApp({ fetch: fetchMock as unknown as typeof fetch, now: () => t })
    await app.request("/v1/usage/consume", post({ userId: "p", host: "framer", feature: "audit", licenseKey: "KEY-1" }), env)
    up = false
    t += 2 * 3600 * 1000 // cache expired → revalidation fails → fall back to cached verdict
    const res = await app.request("/v1/usage/consume", post({ userId: "p", host: "framer", feature: "audit", licenseKey: "KEY-1" }), env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ plan: "pro" })
  })

  it("reports 503 when Polar is unreachable during explicit activation", async () => {
    const app = createApp({ fetch: (async () => new Response("", { status: 502 })) as unknown as typeof fetch })
    const res = await app.request("/v1/license/validate", post({ key: "SOME-KEY" }), makeEnv())
    expect(res.status).toBe(503)
  })

  it("rejects malformed requests", async () => {
    const app = createApp()
    const env = makeEnv()
    expect((await app.request("/v1/usage/consume", post({ userId: "u", host: "figma", feature: "audit" }), env)).status).toBe(400)
    expect((await app.request("/v1/usage/consume", post({ userId: "bad id with spaces", host: "framer", feature: "audit" }), env)).status).toBe(400)
    expect((await app.request("/v1/usage/consume", post({ userId: "u", host: "framer", feature: "mining" }), env)).status).toBe(400)
    expect((await app.request("/v1/usage/consume", { method: "POST", body: "not json" }, env)).status).toBe(400)
    expect((await app.request("/v1/license/validate", post({ key: "" }), env)).status).toBe(400)
  })

  it("caps free requests per IP per day to stop user-id rotation", async () => {
    const env = makeEnv({ IP_DAILY_LIMIT: "3" })
    const app = createApp({ fetch: polarMock({}) })
    const codes: number[] = []
    for (let i = 0; i < 4; i++) {
      codes.push((await app.request("/v1/usage/consume", post({ userId: `rotating-${i}`, host: "framer", feature: "audit" }), env)).status)
    }
    expect(codes).toEqual([200, 200, 200, 429])
  })

  it("applies CORS for Framer and Webflow plugin origins only, exposing rate-limit headers", async () => {
    const app = createApp()
    const env = makeEnv()
    const preflight = (origin: string) =>
      app.request("/v1/usage/consume", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } }, env)
    expect((await preflight("https://abc123.webflow-ext.com")).headers.get("access-control-allow-origin")).toBe("https://abc123.webflow-ext.com")
    expect((await preflight("https://plugin-5e0a11.plugins.framercdn.com")).headers.get("access-control-allow-origin")).toBe("https://plugin-5e0a11.plugins.framercdn.com")
    expect((await preflight("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull()
    const res = await app.request("/health", { headers: { origin: "http://localhost:5173" } }, env)
    expect(res.headers.get("access-control-expose-headers")).toContain("retry-after")
  })

  it("proxies allow-listed Webflow Data API calls and forwards rate-limit headers", async () => {
    const fetchMock = polarMock({})
    const app = createApp({ fetch: fetchMock })
    const env = makeEnv()
    const res = await app.request(
      "/v1/webflow/collections/col_1/items?limit=100&offset=0",
      { headers: { authorization: "Bearer wf_token_1234567890" } },
      env,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ upstream: "https://api.webflow.com/v2/collections/col_1/items?limit=100&offset=0", method: "GET" })
    expect(res.headers.get("x-ratelimit-remaining")).toBe("59")
    expect(res.headers.get("x-other")).toBeNull()

    const patch = await app.request(
      "/v1/webflow/collections/col_1/items",
      { method: "PATCH", headers: { authorization: "Bearer wf_token_1234567890", "content-type": "application/json" }, body: JSON.stringify({ items: [] }) },
      env,
    )
    expect(patch.status).toBe(200)
  })

  it("refuses non-allow-listed proxy paths and missing tokens", async () => {
    const app = createApp({ fetch: polarMock({}) })
    const env = makeEnv()
    expect((await app.request("/v1/webflow/sites/abc", { method: "DELETE", headers: { authorization: "Bearer wf_token_1234567890" } }, env)).status).toBe(403)
    expect((await app.request("/v1/webflow/token/introspect", { headers: { authorization: "Bearer wf_token_1234567890" } }, env)).status).toBe(403)
    expect((await app.request("/v1/webflow/collections/col_1/items", {}, env)).status).toBe(401)
  })
})
