import { Hono, type Context } from "hono"
import { cors } from "hono/cors"

/**
 * License + metering worker for the Visual SEO & Schema Suite.
 *
 *  POST /v1/license/validate   – verify a Polar.sh license key (cached 1h in KV)
 *  POST /v1/usage/status       – current plan / remaining free credits
 *  POST /v1/usage/consume      – spend one free credit (10 per user) or pass through for Pro
 *  ALL  /v1/webflow/*          – CORS proxy to api.webflow.com/v2 (allow-listed CMS + custom-code paths)
 */

export interface Env {
  USAGE: KVNamespace
  POLAR_ORGANIZATION_ID: string
  /** Organization access token (license_keys:read/write). Without it the public customer-portal endpoint is used. */
  POLAR_ACCESS_TOKEN?: string
  /** https://api.polar.sh (production) or https://sandbox-api.polar.sh */
  POLAR_API_BASE?: string
  /** Restrict valid keys to one benefit (product) id. */
  POLAR_BENEFIT_ID?: string
  FREE_LIMIT?: string
  /** Free-tier requests allowed per IP per day (abuse guard for spoofed user ids). */
  IP_DAILY_LIMIT?: string
  CHECKOUT_URL?: string
  /** Comma-separated extra allowed origins. */
  ALLOWED_ORIGINS?: string
}

export interface AppOptions {
  fetch?: typeof fetch
  now?: () => number
}

const HOSTS = new Set(["framer", "webflow", "playground"])
const FEATURES = new Set(["alt-text", "meta", "audit", "schema", "cms-bulk"])
const USER_ID_RE = /^[\w:.@|-]{1,200}$/
const LICENSE_TTL_SECONDS = 3600

const DEFAULT_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/([a-z0-9-]+\.)*framercdn\.com$/,
  /^https:\/\/([a-z0-9-]+\.)*framer\.(com|app|website)$/,
  /^https:\/\/([a-z0-9-]+\.)*webflow-ext\.com$/,
  /^https:\/\/([a-z0-9-]+\.)*webflow\.(com|io)$/,
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
]

/** Webflow Data API paths the proxy will forward. Everything else is refused. */
const WEBFLOW_PATHS: Array<{ method: string; re: RegExp }> = [
  { method: "GET", re: /^\/sites\/[\w-]+\/collections$/ },
  { method: "GET", re: /^\/collections\/[\w-]+$/ },
  { method: "GET", re: /^\/collections\/[\w-]+\/items$/ },
  { method: "PATCH", re: /^\/collections\/[\w-]+\/items(\/live)?$/ },
  { method: "POST", re: /^\/sites\/[\w-]+\/registered_scripts\/inline$/ },
  { method: "PUT", re: /^\/(sites|pages)\/[\w-]+\/custom_code$/ },
]

interface UsageRecord {
  used: number
  firstSeen: number
  lastSeen: number
  features: Record<string, number>
}

interface LicenseCache {
  valid: boolean
  status: string
  expiresAt: string | null
  checkedAt: number
}

export interface UsageResponse {
  plan: "free" | "pro"
  allowed: boolean
  remaining: number | null
  limit: number
  used: number
  checkoutUrl: string | null
  error?: string
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function freeLimit(env: Env): number {
  const n = parseInt(env.FREE_LIMIT ?? "10", 10)
  return Number.isFinite(n) && n >= 0 ? n : 10
}

async function readJson<T>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T
  } catch {
    return null
  }
}

export function createApp(options: AppOptions = {}) {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = options.now ?? Date.now
  const app = new Hono<{ Bindings: Env }>()

  app.use(
    "*",
    cors({
      origin: (origin, c) => {
        if (!origin) return null
        const extra = (c.env.ALLOWED_ORIGINS ?? "").split(",").map((s: string) => s.trim()).filter(Boolean)
        if (extra.includes(origin) || DEFAULT_ORIGIN_PATTERNS.some((re) => re.test(origin))) return origin
        return null
      },
      allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "accept"],
      // The browser-side batch updater needs these to back off correctly.
      exposeHeaders: ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"],
      maxAge: 86400,
    }),
  )

  app.get("/health", (c) => c.json({ ok: true, service: "vss-license-worker" }))

  /** Validate against Polar.sh and cache the verdict in KV for an hour. */
  async function validateLicense(env: Env, key: string, force = false): Promise<LicenseCache & { message?: string }> {
    const cacheKey = `lic:v1:${await sha256(key)}`
    if (!force) {
      const cached = await env.USAGE.get<LicenseCache>(cacheKey, "json")
      if (cached && now() - cached.checkedAt < LICENSE_TTL_SECONDS * 1000) return cached
    }
    const base = (env.POLAR_API_BASE ?? "https://api.polar.sh").replace(/\/$/, "")
    const usePrivate = !!env.POLAR_ACCESS_TOKEN
    const url = usePrivate ? `${base}/v1/license-keys/validate` : `${base}/v1/customer-portal/license-keys/validate`
    const body: Record<string, unknown> = { key, organization_id: env.POLAR_ORGANIZATION_ID }
    if (env.POLAR_BENEFIT_ID) body.benefit_id = env.POLAR_BENEFIT_ID
    let res: Response
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(usePrivate ? { authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(body),
      })
    } catch {
      throw new Error("polar_unreachable")
    }
    if (res.status >= 500) throw new Error("polar_unavailable")
    const data = (await res.json().catch(() => ({}))) as { status?: string; expires_at?: string | null; detail?: unknown }
    let result: LicenseCache & { message?: string }
    if (!res.ok) {
      result = { valid: false, status: res.status === 404 ? "not_found" : "invalid", expiresAt: null, checkedAt: now(), message: "License key not found." }
    } else {
      const status = data.status ?? "granted"
      const expiresAt = data.expires_at ?? null
      const expired = expiresAt !== null && Date.parse(expiresAt) <= now()
      const valid = status === "granted" && !expired
      result = {
        valid,
        status: expired ? "expired" : status,
        expiresAt,
        checkedAt: now(),
        ...(valid ? {} : { message: expired ? "This license has expired." : `This license is ${status}.` }),
      }
    }
    await env.USAGE.put(cacheKey, JSON.stringify(result), { expirationTtl: LICENSE_TTL_SECONDS })
    return result
  }

  async function isPro(env: Env, licenseKey: unknown): Promise<boolean> {
    if (typeof licenseKey !== "string" || !licenseKey.trim()) return false
    try {
      return (await validateLicense(env, licenseKey.trim())).valid
    } catch {
      // Polar outage: don't punish paying users — trust a previously cached verdict if any.
      const cached = await env.USAGE.get<LicenseCache>(`lic:v1:${await sha256(licenseKey.trim())}`, "json")
      return cached?.valid ?? false
    }
  }

  function parseIdentity(body: { userId?: unknown; host?: unknown } | null): { userId: string; host: string } | null {
    if (!body || typeof body.userId !== "string" || typeof body.host !== "string") return null
    if (!USER_ID_RE.test(body.userId) || !HOSTS.has(body.host)) return null
    return { userId: body.userId, host: body.host }
  }

  async function usageKey(host: string, userId: string) {
    return `usage:v1:${host}:${await sha256(userId)}`
  }

  async function readUsage(env: Env, key: string): Promise<UsageRecord> {
    return (await env.USAGE.get<UsageRecord>(key, "json")) ?? { used: 0, firstSeen: now(), lastSeen: now(), features: {} }
  }

  function freeResponse(env: Env, used: number, allowed: boolean, error?: string): UsageResponse {
    const limit = freeLimit(env)
    return {
      plan: "free",
      allowed,
      remaining: Math.max(0, limit - used),
      limit,
      used,
      checkoutUrl: env.CHECKOUT_URL ?? null,
      ...(error ? { error } : {}),
    }
  }

  function proResponse(env: Env, used = 0): UsageResponse {
    return { plan: "pro", allowed: true, remaining: null, limit: freeLimit(env), used, checkoutUrl: null }
  }

  app.post("/v1/license/validate", async (c) => {
    const body = await readJson<{ key?: unknown; userId?: unknown; host?: unknown }>(c)
    if (!body || typeof body.key !== "string" || body.key.trim().length < 4 || body.key.length > 200) {
      return c.json({ valid: false, plan: "free", message: "Enter a license key." }, 400)
    }
    try {
      const result = await validateLicense(c.env, body.key.trim(), true)
      return c.json({ valid: result.valid, plan: result.valid ? "pro" : "free", status: result.status, expiresAt: result.expiresAt, message: result.message })
    } catch {
      return c.json({ valid: false, plan: "free", message: "License server temporarily unavailable — try again shortly." }, 503)
    }
  })

  app.post("/v1/usage/status", async (c) => {
    const body = await readJson<{ userId?: unknown; host?: unknown; licenseKey?: unknown }>(c)
    const id = parseIdentity(body)
    if (!id) return c.json({ error: "Invalid userId or host" }, 400)
    const record = await readUsage(c.env, await usageKey(id.host, id.userId))
    if (await isPro(c.env, body?.licenseKey)) return c.json(proResponse(c.env, record.used))
    return c.json(freeResponse(c.env, record.used, record.used < freeLimit(c.env)))
  })

  app.post("/v1/usage/consume", async (c) => {
    const body = await readJson<{ userId?: unknown; host?: unknown; feature?: unknown; licenseKey?: unknown }>(c)
    const id = parseIdentity(body)
    if (!id || typeof body?.feature !== "string" || !FEATURES.has(body.feature)) return c.json({ error: "Invalid request" }, 400)
    const key = await usageKey(id.host, id.userId)
    const record = await readUsage(c.env, key)
    const bump = async () => {
      record.used += 1
      record.lastSeen = now()
      record.features[body.feature as string] = (record.features[body.feature as string] ?? 0) + 1
      await c.env.USAGE.put(key, JSON.stringify(record))
    }

    if (await isPro(c.env, body.licenseKey)) {
      await bump() // analytics only; never blocks Pro
      return c.json(proResponse(c.env, record.used))
    }

    const limit = freeLimit(c.env)
    if (record.used >= limit) return c.json(freeResponse(c.env, record.used, false), 402)

    // Per-IP daily guard so rotating fake user ids can't farm unlimited free credits.
    const ip = c.req.header("cf-connecting-ip") ?? "unknown"
    const day = new Date(now()).toISOString().slice(0, 10)
    const ipKey = `ip:v1:${day}:${await sha256(ip)}`
    const ipCount = parseInt((await c.env.USAGE.get(ipKey)) ?? "0", 10)
    const ipLimit = parseInt(c.env.IP_DAILY_LIMIT ?? "60", 10)
    if (ipCount >= ipLimit) return c.json(freeResponse(c.env, record.used, false, "Too many free requests from this network today."), 429)

    // KV is eventually consistent: a burst of parallel calls may slip one extra credit. Acceptable
    // for a soft free tier; move this record to a Durable Object if strict counting is needed.
    await bump()
    await c.env.USAGE.put(ipKey, String(ipCount + 1), { expirationTtl: 60 * 60 * 26 })
    return c.json(freeResponse(c.env, record.used, true))
  })

  app.all("/v1/webflow/*", async (c) => {
    const path = c.req.path.replace(/^\/v1\/webflow/, "")
    const method = c.req.method.toUpperCase()
    if (method === "OPTIONS") return c.body(null, 204)
    if (!WEBFLOW_PATHS.some((p) => p.method === method && p.re.test(path))) {
      return c.json({ message: "Path not allowed by proxy" }, 403)
    }
    const auth = c.req.header("authorization")
    if (!auth || !/^Bearer [\w.-]{10,}$/.test(auth)) return c.json({ message: "Missing Webflow token" }, 401)
    const search = new URL(c.req.url).search
    const upstream = await doFetch(`https://api.webflow.com/v2${path}${search}`, {
      method,
      headers: {
        authorization: auth,
        accept: "application/json",
        ...(method !== "GET" ? { "content-type": "application/json" } : {}),
      },
      ...(method !== "GET" ? { body: await c.req.text() } : {}),
    })
    const headers = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json" })
    for (const h of ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
      const v = upstream.headers.get(h)
      if (v !== null) headers.set(h, v)
    }
    return new Response(upstream.body, { status: upstream.status, headers })
  })

  app.notFound((c) => c.json({ error: "Not found" }, 404))
  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: "Internal error" }, 500)
  })

  return app
}
