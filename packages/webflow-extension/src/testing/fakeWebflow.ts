/**
 * In-memory Webflow Designer API used by Vitest and installed as `window.webflow` in the `e2e`
 * build so Playwright can exercise the real extension UI headlessly. Also ships a fake Data API
 * `fetch` that enforces a requests-per-minute limit and answers 429 with Retry-After.
 */

type Id = { component: string; element: string }

export interface FakeAsset {
  id: string
  url: string
  name: string
  alt: string | null
  mime: string
}

interface FakeElementInit {
  element: string
  type: string
  parent?: string | null
  text?: string
  headingLevel?: number
  assetId?: string
  alt?: string | null
  styles?: Record<string, string>
  displayName?: string
  attributes?: Record<string, string>
}

export interface FakeWebflowState {
  elements: FakeElement[]
  assets: FakeAsset[]
  selected: string | null
  page: { id: string; name: string; title: string; description: string; slug: string }
  site: { siteId: string; siteName: string; shortName: string }
  notifications: Array<{ type: string; message: string }>
  idToken: string
}

export class FakeElement {
  readonly id: Id
  readonly type: string
  parent: string | null
  readonly children: boolean
  readonly customAttributes = true
  readonly textContent: boolean
  text?: string
  alt: string | null
  assetId?: string
  styles: Record<string, string>
  customAttrs: Record<string, string> = {}
  attributes: Record<string, string>
  tag: string | null = null
  content: string | null = null
  removed = false
  private readonly displayName?: string
  private readonly headingLevel?: number
  getText?: () => Promise<string | null>

  constructor(
    private readonly state: FakeWebflowState,
    init: FakeElementInit,
  ) {
    this.id = { component: "page", element: init.element }
    this.type = init.type
    this.parent = init.parent ?? null
    this.children = init.type !== "String" && init.type !== "Image"
    this.textContent = init.type === "DOM"
    this.alt = init.alt ?? null
    this.assetId = init.assetId
    this.styles = init.styles ?? {}
    this.attributes = init.attributes ?? {}
    this.displayName = init.displayName
    this.headingLevel = init.headingLevel
    if (init.type === "String") {
      this.text = init.text ?? ""
      this.getText = async () => this.text ?? null
    }
  }

  async getChildren() {
    return this.state.elements.filter((e) => !e.removed && e.parent === this.id.element)
  }
  async getAltText() {
    return this.alt
  }
  async setAltText(alt: string | null) {
    this.alt = alt
    return null
  }
  async getAsset() {
    const a = this.state.assets.find((x) => x.id === this.assetId)
    return a ? fakeAsset(a) : null
  }
  async getHeadingLevel() {
    return this.headingLevel ?? null
  }
  async getDisplayName() {
    return this.displayName ?? null
  }
  async getCustomAttribute(name: string) {
    return this.customAttrs[name] ?? null
  }
  async setCustomAttribute(name: string, value: string) {
    this.customAttrs[name] = value
    return null
  }
  async getStyles() {
    const styles = this.styles
    return [{ getProperty: async (p: string) => styles[p] ?? null }]
  }
  async setTag(tag: string) {
    this.tag = tag
    return null
  }
  async getTag() {
    return this.tag
  }
  async setAttribute(name: string, value: string) {
    this.attributes[name] = value
    return null
  }
  async getAttribute(name: string) {
    return this.attributes[name] ?? null
  }
  async setTextContent(content: string) {
    this.content = content
    return null
  }
  async remove() {
    this.removed = true
    return null
  }
  append = async (_preset: unknown) => {
    const el = new FakeElement(this.state, { element: `dom-${this.state.elements.length}`, type: "DOM", parent: this.id.element })
    this.state.elements.push(el)
    return el
  }
}

function fakeAsset(a: FakeAsset) {
  return {
    id: a.id,
    getUrl: async () => a.url,
    getName: async () => a.name,
    getAltText: async () => a.alt,
    setAltText: async (alt: string | null) => {
      a.alt = alt
      return null
    },
    getMimeType: async () => a.mime,
  }
}

function svgDataUri(color: string, label: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="${color}"/><text x="60" y="46" font-size="12" fill="#fff" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`)}`
}

export function createFakeWebflowState(): FakeWebflowState {
  const state: FakeWebflowState = {
    elements: [],
    assets: [
      { id: "as-hero", url: svgDataUri("#0b6bcb", "hero"), name: "64f0c0ffee12345678901234_mountain-cabin-at-sunrise.jpg", alt: null, mime: "image/jpeg" },
      { id: "as-logo", url: svgDataUri("#222", "logo"), name: "acme-logo-final.svg", alt: "", mime: "image/svg+xml" },
      { id: "as-pdf", url: "https://cdn.prod.website-files.com/brochure.pdf", name: "brochure.pdf", alt: null, mime: "application/pdf" },
    ],
    selected: "section-hero",
    page: { id: "page-home", name: "Home", title: "Acme Cabins", description: "", slug: "index" },
    site: { siteId: "site-123", siteName: "Acme Cabins", shortName: "acme-cabins" },
    notifications: [],
    // header.payload.signature with {"user":{"id":"wf-user-42"}}
    idToken: `e30.${btoa(JSON.stringify({ user: { id: "wf-user-42" } })).replace(/=+$/, "")}.sig`,
  }
  const add = (init: FakeElementInit) => state.elements.push(new FakeElement(state, init))
  add({ element: "body", type: "Body" })
  add({ element: "section-hero", type: "Section", parent: "body", displayName: "Hero" })
  add({ element: "h1", type: "Heading", parent: "section-hero", headingLevel: 1, styles: { color: "#ffffff", "background-color": "#1e1e1e", "font-size": "48px" } })
  add({ element: "h1-text", type: "String", parent: "h1", text: "Cabins in the mountains" })
  add({ element: "p1", type: "Paragraph", parent: "section-hero", styles: { color: "#555555", "background-color": "#1e1e1e", "font-size": "16px" } })
  add({ element: "p1-text", type: "String", parent: "p1", text: "Book a quiet cabin with mountain views, wood stoves and hiking trails from the door." })
  add({ element: "img-hero", type: "Image", parent: "section-hero", assetId: "as-hero", alt: null, displayName: "Hero image" })
  add({ element: "h3", type: "Heading", parent: "body", headingLevel: 3, styles: { color: "#111111", "background-color": "#ffffff", "font-size": "20px" } })
  add({ element: "h3-text", type: "String", parent: "h3", text: "Do you allow pets?" })
  add({ element: "p2", type: "Paragraph", parent: "body", styles: { color: "#333333", "background-color": "#ffffff" } })
  add({ element: "p2-text", type: "String", parent: "p2", text: "Yes, two of our cabins welcome dogs for a small cleaning fee." })
  add({ element: "img-logo", type: "Image", parent: "body", assetId: "as-logo", alt: "", displayName: "Logo" })
  add({ element: "link-more", type: "Link", parent: "body" })
  add({ element: "link-more-text", type: "String", parent: "link-more", text: "click here" })
  add({ element: "btn-icon", type: "LinkBlock", parent: "body", displayName: "Cart button" })
  return state
}

export function createFakeWebflow(state: FakeWebflowState = createFakeWebflowState()) {
  const visible = () => state.elements.filter((e) => !e.removed)
  const page = {
    id: state.page.id,
    getName: async () => state.page.name,
    getTitle: async () => state.page.title,
    setTitle: async (t: string | null) => {
      state.page.title = t ?? ""
      return null
    },
    getDescription: async () => state.page.description,
    setDescription: async (d: string | null) => {
      state.page.description = d ?? ""
      return null
    },
    getSlug: async () => state.page.slug,
  }
  return {
    state,
    getSelectedElement: async () => visible().find((e) => e.id.element === state.selected) ?? null,
    getAllElements: async () => visible(),
    getAllAssets: async () => state.assets.map(fakeAsset),
    getCurrentPage: async () => page,
    getSiteInfo: async () => ({
      ...state.site,
      kind: "site" as const,
      isPasswordProtected: false,
      isPrivateStaging: false,
      workspaceId: "ws",
      workspaceSlug: "ws",
      domains: [{ url: "acme-cabins.com", lastPublished: null, default: true, stage: "production" as const }],
    }),
    getIdToken: async () => state.idToken,
    getRootElement: async () => visible().find((e) => e.type === "Body") ?? null,
    elementPresets: { DOM: { preset: "DOM" } },
    notify: async (opts: { type: string; message: string }) => {
      state.notifications.push(opts)
    },
    subscribe: () => () => {},
    setExtensionSize: async () => null,
  }
}

export interface FakeCmsItem {
  id: string
  fieldData: Record<string, unknown>
}

/**
 * Fake Webflow Data API v2 (`fetch`-compatible). Enforces `limitPerWindow` requests per window and
 * replies 429 + Retry-After beyond it, like the real API.
 */
export function createFakeDataApi(options: { limitPerWindow?: number; retryAfterSeconds?: number; now?: () => number } = {}) {
  const limit = options.limitPerWindow ?? 60
  const now = options.now ?? Date.now
  const windowMs = 60_000
  let windowStart = now()
  let count = 0
  const calls: Array<{ method: string; path: string; status: number; body?: unknown }> = []
  const collections = [
    {
      id: "col-1",
      displayName: "Cabins",
      slug: "cabins",
      fields: [
        { id: "f1", slug: "name", displayName: "Name", type: "PlainText" },
        { id: "f2", slug: "main-image", displayName: "Main image", type: "Image" },
        { id: "f3", slug: "seo-description", displayName: "SEO description", type: "PlainText" },
        { id: "f4", slug: "body", displayName: "Body", type: "RichText" },
      ],
    },
  ]
  const items: FakeCmsItem[] = Array.from({ length: 250 }, (_, i) => ({
    id: `item-${i + 1}`,
    fieldData: {
      name: `Cabin ${i + 1}`,
      slug: `cabin-${i + 1}`,
      "main-image": { fileId: `file-${i + 1}`, url: `https://cdn.prod.website-files.com/site/64f0c0ffee12345678901234_cabin-${i + 1}-exterior.jpg`, alt: null },
      "seo-description": "",
      body: `<p>Cabin ${i + 1} sleeps four and has a wood stove, a full kitchen and a deck facing the lake.</p>`,
    },
  }))

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const method = (init.method ?? "GET").toUpperCase()
    const path = url.pathname.replace(/^.*\/v2/, "")
    if (now() - windowStart >= windowMs) {
      windowStart = now()
      count = 0
    }
    count++
    const remaining = Math.max(0, limit - count)
    const rlHeaders = { "x-ratelimit-limit": String(limit), "x-ratelimit-remaining": String(remaining) }
    if (count > limit) {
      calls.push({ method, path, status: 429 })
      return json(429, { message: "Too many requests" }, { ...rlHeaders, "retry-after": String(options.retryAfterSeconds ?? Math.ceil((windowMs - (now() - windowStart)) / 1000)) })
    }
    const auth = new Headers(init.headers).get("authorization")
    if (auth !== "Bearer test-token") {
      calls.push({ method, path, status: 401 })
      return json(401, { message: "Invalid token" }, rlHeaders)
    }
    if (method === "GET" && /^\/sites\/[^/]+\/collections$/.test(path)) {
      calls.push({ method, path, status: 200 })
      return json(200, { collections: collections.map(({ fields: _f, ...c }) => c) }, rlHeaders)
    }
    const colMatch = path.match(/^\/collections\/([^/]+)$/)
    if (method === "GET" && colMatch) {
      calls.push({ method, path, status: 200 })
      return json(200, collections.find((c) => c.id === colMatch[1]), rlHeaders)
    }
    if (method === "GET" && /^\/collections\/[^/]+\/items$/.test(path)) {
      const offset = Number(url.searchParams.get("offset") ?? 0)
      const lim = Number(url.searchParams.get("limit") ?? 100)
      calls.push({ method, path, status: 200 })
      return json(200, { items: items.slice(offset, offset + lim), pagination: { total: items.length, offset, limit: lim } }, rlHeaders)
    }
    if (method === "PATCH" && /^\/collections\/[^/]+\/items(\/live)?$/.test(path)) {
      const body = JSON.parse(String(init.body)) as { items: Array<{ id: string; fieldData: Record<string, unknown> }> }
      if (body.items.length > 100) {
        calls.push({ method, path, status: 400, body })
        return json(400, { message: "Max 100 items" }, rlHeaders)
      }
      const invalid = body.items.find((i) => typeof i.fieldData["seo-description"] === "string" && (i.fieldData["seo-description"] as string).length > 500)
      if (invalid) {
        calls.push({ method, path, status: 400, body })
        return json(400, { message: "Validation Error", details: [{ param: "seo-description", description: "too long" }] }, rlHeaders)
      }
      for (const u of body.items) {
        const item = items.find((i) => i.id === u.id)
        if (item) item.fieldData = { ...item.fieldData, ...u.fieldData }
      }
      calls.push({ method, path, status: 200, body })
      return json(200, { items: body.items }, rlHeaders)
    }
    if (method === "POST" && /registered_scripts\/inline$/.test(path)) {
      calls.push({ method, path, status: 403 })
      return json(403, { message: "Missing scope custom_code:write" }, rlHeaders)
    }
    calls.push({ method, path, status: 404 })
    return json(404, { message: "Not found" }, rlHeaders)
  }

  return { fetch: fetchImpl as typeof fetch, calls, items, collections }
}

/** Installs a fake `window.webflow` for the e2e build. */
export function installFakeWebflow() {
  const fake = createFakeWebflow()
  ;(globalThis as unknown as { webflow: unknown }).webflow = fake
  ;(globalThis as unknown as { __VSS_FAKE_WEBFLOW__: unknown }).__VSS_FAKE_WEBFLOW__ = fake
  return fake
}
