import { HttpError, RateLimiter, parseRetryAfter, withRetry, type Sleep } from "@vss/core-engine"
import { runBatchUpdate, type BatchResult } from "./batchUpdater.ts"

/** Minimal typed client for the Webflow Data API v2 CMS endpoints used by the suite. */

export interface WebflowField {
  id: string
  slug: string
  displayName: string
  type: string
  isRequired?: boolean
}

export interface WebflowCollection {
  id: string
  displayName: string
  singularName?: string
  slug: string
  fields?: WebflowField[]
}

export interface WebflowImageRef {
  fileId?: string
  url: string
  alt?: string | null
}

export interface WebflowItem {
  id: string
  isDraft?: boolean
  isArchived?: boolean
  lastPublished?: string | null
  fieldData: Record<string, unknown> & { name?: string; slug?: string }
}

export interface WebflowCmsClientOptions {
  /** Site API token or OAuth access token with cms:read / cms:write. */
  token: string
  /**
   * API base. Browsers can't call api.webflow.com directly (no CORS), so the extension routes
   * through the license worker's `/v1/webflow` proxy. Defaults to the public API for server use.
   */
  baseUrl?: string
  fetch?: typeof fetch
  ratePerMinute?: number
  sleep?: Sleep
  now?: () => number
}

export const WEBFLOW_API = "https://api.webflow.com/v2"

export class WebflowCmsClient {
  readonly limiter: RateLimiter
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly opts: WebflowCmsClientOptions

  constructor(options: WebflowCmsClientOptions) {
    this.opts = options
    this.baseUrl = (options.baseUrl ?? WEBFLOW_API).replace(/\/+$/, "")
    this.fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
    const rate = options.ratePerMinute ?? 60
    this.limiter = new RateLimiter({
      tokensPerInterval: rate,
      intervalMs: 60_000,
      capacity: Math.min(rate, 10),
      ...(options.now ? { now: options.now } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    })
  }

  private async raw(method: string, path: string, body?: unknown, signal?: AbortSignal) {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { message: text }
    }
    return { status: res.status, headers: res.headers, body: json }
  }

  /** Rate-limited request with retry on 429/5xx for reads and single writes. */
  async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return withRetry(
      async () => {
        await this.limiter.acquire(signal)
        const res = await this.raw(method, path, body, signal)
        const limit = Number(res.headers.get("x-ratelimit-limit"))
        const remaining = res.headers.get("x-ratelimit-remaining")
        this.limiter.update({ limit: limit > 0 ? limit : null, remaining: remaining === null ? null : Number(remaining) })
        if (res.status === 429) {
          const retryAfterMs = parseRetryAfter(res.headers) ?? 60_000
          this.limiter.pauseFor(retryAfterMs)
          throw new HttpError(429, "Rate limited by Webflow", { retryAfterMs })
        }
        if (res.status >= 400) {
          const msg = (res.body as { message?: string } | null)?.message ?? `HTTP ${res.status}`
          throw new HttpError(res.status, `Webflow API: ${msg}`, { body: res.body })
        }
        return res.body as T
      },
      { retries: 6, baseDelayMs: 1000, maxDelayMs: 60_000, ...(signal ? { signal } : {}), ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}) },
    )
  }

  async listCollections(siteId: string): Promise<WebflowCollection[]> {
    const res = await this.request<{ collections: WebflowCollection[] }>("GET", `/sites/${encodeURIComponent(siteId)}/collections`)
    return res.collections ?? []
  }

  async getCollection(collectionId: string): Promise<WebflowCollection> {
    return this.request<WebflowCollection>("GET", `/collections/${encodeURIComponent(collectionId)}`)
  }

  /** All (staged) items, following offset pagination. */
  async listItems(collectionId: string, signal?: AbortSignal): Promise<WebflowItem[]> {
    const out: WebflowItem[] = []
    let offset = 0
    const limit = 100
    for (;;) {
      const res = await this.request<{ items: WebflowItem[]; pagination?: { total: number; offset: number; limit: number } }>(
        "GET",
        `/collections/${encodeURIComponent(collectionId)}/items?limit=${limit}&offset=${offset}`,
        undefined,
        signal,
      )
      out.push(...(res.items ?? []))
      const total = res.pagination?.total ?? out.length
      offset += limit
      if (offset >= total || (res.items ?? []).length === 0) break
    }
    return out
  }

  /**
   * Bulk-update staged items (PATCH /collections/:id/items, ≤100 per request), throttled with
   * backoff. Set `live` to update published items instead (PATCH …/items/live).
   */
  async updateItems(
    collectionId: string,
    items: Array<{ id: string; fieldData: Record<string, unknown> }>,
    options: { live?: boolean; onProgress?: (done: number, total: number) => void; signal?: AbortSignal; onRateLimited?: (info: { retryAfterMs: number }) => void } = {},
  ): Promise<BatchResult> {
    const path = `/collections/${encodeURIComponent(collectionId)}/items${options.live ? "/live" : ""}`
    return runBatchUpdate({
      items,
      chunkSize: 100,
      itemId: (i) => i.id,
      limiter: this.limiter,
      send: (chunk) => this.raw("PATCH", path, { items: chunk }, options.signal),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.onRateLimited ? { onRateLimited: options.onRateLimited } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
    })
  }

  /**
   * Register an inline script (≤2000 chars) and attach it to the site or a page head. Requires an
   * app token with custom_code:write; callers fall back to copy/paste when this is refused.
   */
  async upsertHeadScript(params: { siteId: string; pageId?: string; sourceCode: string; displayName: string; version: string }) {
    if (params.sourceCode.length > 2000) throw new Error("Inline scripts are limited to 2000 characters")
    const script = await this.request<{ id: string; version: string }>("POST", `/sites/${encodeURIComponent(params.siteId)}/registered_scripts/inline`, {
      sourceCode: params.sourceCode,
      displayName: params.displayName,
      version: params.version,
    })
    const target = params.pageId ? `/pages/${encodeURIComponent(params.pageId)}/custom_code` : `/sites/${encodeURIComponent(params.siteId)}/custom_code`
    await this.request("PUT", target, { scripts: [{ id: script.id, location: "header", version: script.version }] })
    return script
  }
}
