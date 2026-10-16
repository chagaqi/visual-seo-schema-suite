import {
  memoryStore,
  type AltTextUpdate,
  type ApplyResult,
  type AuditIssue,
  type AuditNode,
  type CmsCollection,
  type CmsImageValue,
  type CmsItem,
  type CmsUpdate,
  type HostAdapter,
  type HostImage,
  type ImageScope,
  type JsonLdObject,
  type NotifyVariant,
  type PageInfo,
  type StructuredDataTarget,
} from "@vss/core-engine"

/** Inline SVG data URIs so the playground works offline. */
function swatch(color: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="${color}"/><text x="60" y="46" font-family="sans-serif" font-size="12" fill="#fff" text-anchor="middle">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export interface MockState {
  images: Array<HostImage & { scope: ImageScope[] }>
  page: PageInfo
  auditNodes: AuditNode[]
  collections: CmsCollection[]
  items: Record<string, CmsItem[]>
  structuredData: Record<StructuredDataTarget, JsonLdObject[]>
  selectedSvg: string | null
  insertedSvgs: Array<{ svg: string; name: string }>
  notifications: Array<{ message: string; variant: NotifyVariant }>
  pageMeta: { title?: string; description?: string }
  appliedFixes: string[]
}

export interface MockAdapter extends HostAdapter {
  state: MockState
}

export function defaultMockState(): MockState {
  return {
    images: [
      { id: "img-hero", src: swatch("#0b6bcb", "hero"), filename: "hero-barista-pouring-latte-art@2x.jpg", alt: null, name: "Image", location: "Home / Hero", width: 1600, height: 900, scope: ["selection", "page", "project"] },
      { id: "img-logo", src: swatch("#222", "logo"), filename: "blue-door-logo-final-v2.svg", alt: "logo", name: "Logo", location: "Home / Nav", width: 120, height: 32, scope: ["page", "project"] },
      { id: "img-team", src: swatch("#7a3cff", "team"), filename: "6512a7b3c9d4e5f6a7b8c9d0_team-roasting-session.jpg", alt: "Our team roasting coffee beans together", name: "Team photo", location: "About", width: 800, height: 600, scope: ["project"] },
      { id: "img-divider", src: swatch("#444", "divider"), filename: "section-divider-squiggle.svg", alt: null, name: "Divider", location: "Home", width: 1200, height: 24, scope: ["page", "project"] },
      { id: "img-hash", src: swatch("#c2410c", "?"), filename: "aBc9XyZ12qWeRtY7uIoP.png", alt: null, name: "Image 4", location: "Home / Gallery", pageTitle: "Blue Door Coffee — Specialty Roasters", width: 600, height: 600, scope: ["page", "project"] },
    ],
    page: {
      id: "home",
      title: "Blue Door Coffee — Specialty Roasters",
      description: "",
      url: "https://bluedoor.coffee/",
      lang: "en",
      brand: "Blue Door Coffee",
      headings: ["Specialty coffee, roasted daily", "Do you ship internationally?", "What brew methods do you recommend?"],
      bodyText:
        "Blue Door Coffee roasts single-origin beans in small batches every morning in San Francisco. We source directly from farmers in Ethiopia, Colombia and Guatemala, paying well above fair-trade prices. Visit our Valencia Street café for pour-over, espresso and fresh pastries.",
      sections: [
        { heading: "Do you ship internationally?", text: "Yes, we ship to over forty countries and calculate duties at checkout." },
        { heading: "What brew methods do you recommend?", text: "Pour-over brings out bright, fruity notes; espresso suits our chocolatey house blend." },
      ],
    },
    auditNodes: [
      { kind: "text", id: "t-h1", name: "Hero title", text: "Specialty coffee, roasted daily", color: "#ffffff", background: "#111111", fontSizePx: 48, fontWeight: 700, tag: "h1" },
      { kind: "text", id: "t-sub", name: "Hero subtitle", text: "Small batches, big flavour", color: "#555555", background: "#111111", fontSizePx: 16, tag: "p" },
      { kind: "text", id: "t-h3", name: "Card title", text: "Single origin", color: "#ffffff", background: "#1b1b1b", fontSizePx: 20, tag: "h3" },
      { kind: "image", id: "img-hero", name: "Hero image", src: "https://cdn.example.com/hero-barista-pouring-latte-art.jpg", alt: null },
      { kind: "link", id: "l-more", name: "Read more link", text: "Read more", href: "/blog", width: 70, height: 18 },
      { kind: "button", id: "b-cart", name: "Cart icon button", text: "", width: 32, height: 32 },
    ],
    collections: [
      {
        id: "blog",
        name: "Blog Posts",
        fields: [
          { id: "f-cover", name: "Cover image", type: "image" },
          { id: "f-meta", name: "Meta description", type: "text" },
          { id: "f-body", name: "Body", type: "richtext" },
        ],
        itemCount: 3,
      },
    ],
    items: {
      blog: [
        { id: "p1", title: "How to brew pour-over coffee", fieldData: { "f-cover": { url: "https://cdn.example.com/pour-over-kettle-v60.jpg", alt: null }, "f-meta": "", "f-body": "<p>Pour-over brewing gives you full control over extraction. Start with a medium-fine grind and water just off the boil.</p><p>Bloom for 30 seconds, then pour in slow circles.</p>" } },
        { id: "p2", title: "Meet our Ethiopian farmers", fieldData: { "f-cover": { url: "https://framerusercontent.com/images/Zx81Kq0LmP2nB5vC7xQ.jpg", alt: "" }, "f-meta": "", "f-body": "<p>Our Yirgacheffe lots come from a cooperative of 300 smallholder farmers who process every cherry by hand.</p>" } },
        { id: "p3", title: "Espresso at home on a budget", fieldData: { "f-cover": { url: "https://cdn.example.com/IMG_4021.jpg", alt: "Espresso shot pulling into a glass cup" }, "f-meta": "Great espresso doesn't need a $3,000 machine.", "f-body": "<p>Great espresso doesn't need a $3,000 machine. A good grinder matters more than the machine itself.</p>" } },
      ],
    },
    structuredData: { site: [], page: [] },
    selectedSvg: `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Sketch 99 -->\n<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns">\n  <title>Cup</title>\n  <desc>Created with Sketch.</desc>\n  <g id="Page-1" stroke="none" fill="none" sketch:type="MSPage">\n    <path d="M 4.000000 6.000000 L 18.000000 6.000000 L 16.500000 18.000000 C 16.400000 19.100000 15.500000 20.000000 14.400000 20.000000 L 7.600000 20.000000 Z" fill="#FFFFFF"/>\n  </g>\n</svg>`,
    insertedSvgs: [],
    notifications: [],
    pageMeta: {},
    appliedFixes: [],
  }
}

/** Fully in-memory host used by the playground, UI tests and E2E smoke tests. */
export function createMockAdapter(overrides: Partial<MockState> = {}, options: { latencyMs?: number } = {}): MockAdapter {
  const state: MockState = { ...defaultMockState(), ...overrides }
  const delay = () => new Promise<void>((r) => setTimeout(r, options.latencyMs ?? 0))

  const adapter: MockAdapter = {
    name: "playground",
    displayName: "Playground",
    capabilities: { selection: true, setPageMeta: true, cms: true, headCode: true, svg: true, auditFixes: true },
    state,
    projectStorage: memoryStore(),
    deviceStorage: memoryStore(),
    async getUser() {
      return { id: "playground-user", name: "Playground" }
    },
    async listImages(scope) {
      await delay()
      return state.images.filter((i) => i.scope.includes(scope)).map(({ scope: _s, ...img }) => ({ ...img }))
    },
    async applyAltText(updates: AltTextUpdate[], onProgress): Promise<ApplyResult> {
      const failed: ApplyResult["failed"] = []
      let done = 0
      for (const u of updates) {
        await delay()
        const img = state.images.find((i) => i.id === u.id)
        if (img) img.alt = u.alt
        else failed.push({ id: u.id, error: "Not found" })
        onProgress?.(++done, updates.length)
      }
      return { updated: updates.length - failed.length, failed }
    },
    async getPageInfo() {
      await delay()
      return { ...state.page, description: state.pageMeta.description ?? state.page.description, title: state.pageMeta.title ?? state.page.title }
    },
    async setPageMeta(meta) {
      await delay()
      state.pageMeta = { ...state.pageMeta, ...meta }
    },
    async collectAuditNodes() {
      await delay()
      return {
        nodes: state.auditNodes.map((n) => {
          if (n.kind !== "image") return n
          const img = state.images.find((i) => i.id === n.id)
          return img ? { ...n, alt: img.alt } : n
        }),
        page: { title: state.page.title, description: state.pageMeta.description ?? state.page.description, lang: state.page.lang },
      }
    },
    async applyAuditFix(issue: AuditIssue) {
      if (!issue.nodeId || !issue.fix) return false
      state.appliedFixes.push(issue.id)
      const node = state.auditNodes.find((n) => n.id === issue.nodeId)
      if (!node) return false
      if (issue.fix.type === "color" && (node.kind === "text" || node.kind === "ui")) node.color = issue.fix.value
      else if (issue.fix.type === "alt" && node.kind === "image") {
        node.alt = issue.fix.value
        const img = state.images.find((i) => i.id === node.id)
        if (img) img.alt = issue.fix.value
      } else if (issue.fix.type === "aria-label" && (node.kind === "link" || node.kind === "button")) node.ariaLabel = issue.fix.value
      else return false
      return true
    },
    async listCollections() {
      await delay()
      return state.collections
    },
    async listCollectionItems(id) {
      await delay()
      return (state.items[id] ?? []).map((i) => ({ ...i, fieldData: { ...i.fieldData } }))
    },
    async updateCollectionItems(id, updates: CmsUpdate[], onProgress, signal) {
      const items = state.items[id] ?? []
      const failed: ApplyResult["failed"] = []
      let done = 0
      for (const u of updates) {
        if (signal?.aborted) {
          failed.push({ id: u.itemId, error: "Cancelled" })
          continue
        }
        await delay()
        const item = items.find((i) => i.id === u.itemId)
        if (!item) failed.push({ id: u.itemId, error: "Not found" })
        else if (u.kind === "text") item.fieldData[u.fieldId] = u.value
        else {
          const img = item.fieldData[u.fieldId] as CmsImageValue | undefined
          if (img) item.fieldData[u.fieldId] = { ...img, alt: u.value }
        }
        onProgress?.(++done, updates.length)
      }
      return { updated: updates.length - failed.length, failed }
    },
    async getStructuredData(target) {
      return [...state.structuredData[target]]
    },
    async saveStructuredData(objects, target) {
      await delay()
      state.structuredData[target] = [...objects]
      return { method: "memory", message: `Saved ${objects.length} schema block${objects.length === 1 ? "" : "s"} to the ${target === "site" ? "site head" : "page"}.` }
    },
    async getSelectedSvg() {
      return state.selectedSvg ? { svg: state.selectedSvg, name: "cup-icon" } : null
    },
    async insertSvg(svg, name) {
      state.insertedSvgs.push({ svg, name })
    },
    notify(message, variant = "info") {
      state.notifications.push({ message, variant })
    },
  }
  return adapter
}
