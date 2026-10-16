import type { HostName, KeyValueStore } from "../host.ts"

/** Features that consume a free credit. SVG minification and the manual contrast checker stay free. */
export type MeteredFeature = "alt-text" | "meta" | "audit" | "schema" | "cms-bulk"

export const FREE_LIMIT = 10

export interface UsageStatus {
  plan: "free" | "pro"
  allowed: boolean
  /** Remaining free credits; null for unlimited (pro). */
  remaining: number | null
  limit: number
  used: number
  checkoutUrl?: string | null
  /** True when the worker was unreachable and a local counter was used. */
  offline?: boolean
  error?: string
}

export interface LicenseValidation {
  valid: boolean
  plan: "free" | "pro"
  status?: string
  expiresAt?: string | null
  message?: string
}

export interface LicenseClientOptions {
  /** License worker base URL, e.g. https://vss-license.<account>.workers.dev */
  baseUrl: string
  host: HostName
  getUserId: () => Promise<string>
  storage: KeyValueStore
  fetch?: typeof fetch
  freeLimit?: number
  timeoutMs?: number
}

const KEY_LICENSE = "vss:license-key"
const KEY_LOCAL_USAGE = "vss:local-usage"

/**
 * Talks to the Polar.sh-backed license worker. Fails open with a local counter when the network is
 * unavailable so a flaky connection never blocks a designer mid-task.
 */
export class LicenseClient {
  private readonly opts: Required<Omit<LicenseClientOptions, "fetch">> & { fetch: typeof fetch }

  constructor(options: LicenseClientOptions) {
    this.opts = {
      freeLimit: FREE_LIMIT,
      timeoutMs: 8000,
      ...options,
      baseUrl: options.baseUrl.replace(/\/+$/, ""),
      fetch: options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args)),
    }
  }

  async getLicenseKey(): Promise<string | null> {
    return this.opts.storage.get(KEY_LICENSE)
  }

  async setLicenseKey(key: string | null): Promise<void> {
    await this.opts.storage.set(KEY_LICENSE, key ? key.trim() : null)
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs)
    try {
      const res = await this.opts.fetch(`${this.opts.baseUrl}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        signal: controller.signal,
      })
      const body = (await res.json().catch(() => ({}))) as T
      return { status: res.status, body }
    } finally {
      clearTimeout(timer)
    }
  }

  private async localUsage(): Promise<number> {
    const raw = await this.opts.storage.get(KEY_LOCAL_USAGE)
    const n = raw ? parseInt(raw, 10) : 0
    return Number.isFinite(n) ? n : 0
  }

  private offlineStatus(used: number, error: string): UsageStatus {
    const limit = this.opts.freeLimit
    return { plan: "free", allowed: used < limit, remaining: Math.max(0, limit - used), limit, used, offline: true, error }
  }

  async status(): Promise<UsageStatus> {
    const userId = await this.opts.getUserId()
    const licenseKey = await this.getLicenseKey()
    try {
      const { status, body } = await this.request<UsageStatus>("/v1/usage/status", {
        method: "POST",
        body: JSON.stringify({ userId, host: this.opts.host, licenseKey }),
      })
      if (status >= 500) throw new Error(`License service error ${status}`)
      return body
    } catch (e) {
      return this.offlineStatus(await this.localUsage(), (e as Error).message)
    }
  }

  /** Spend one credit for `feature`. Resolves with `allowed: false` when the free quota is exhausted. */
  async consume(feature: MeteredFeature): Promise<UsageStatus> {
    const userId = await this.opts.getUserId()
    const licenseKey = await this.getLicenseKey()
    try {
      const { status, body } = await this.request<UsageStatus>("/v1/usage/consume", {
        method: "POST",
        body: JSON.stringify({ userId, host: this.opts.host, feature, licenseKey }),
      })
      if (status >= 500) throw new Error(`License service error ${status}`)
      if (status === 402 || status === 200 || status === 429) return body
      throw new Error(`Unexpected status ${status}`)
    } catch (e) {
      const used = await this.localUsage()
      const result = this.offlineStatus(used, (e as Error).message)
      if (result.allowed) {
        await this.opts.storage.set(KEY_LOCAL_USAGE, String(used + 1))
        return { ...result, used: used + 1, remaining: Math.max(0, this.opts.freeLimit - used - 1) }
      }
      return result
    }
  }

  async activate(key: string): Promise<LicenseValidation> {
    const userId = await this.opts.getUserId()
    try {
      const { body } = await this.request<LicenseValidation>("/v1/license/validate", {
        method: "POST",
        body: JSON.stringify({ key: key.trim(), userId, host: this.opts.host }),
      })
      if (body.valid) await this.setLicenseKey(key)
      return body
    } catch (e) {
      return { valid: false, plan: "free", message: `Could not reach the license server: ${(e as Error).message}` }
    }
  }
}
