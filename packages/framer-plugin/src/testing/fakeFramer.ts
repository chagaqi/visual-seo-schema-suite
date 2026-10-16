/**
 * In-memory stand-in for the Framer Plugin SDK. Implements just enough of the API surface used by
 * `framerAdapter.ts` with realistic shapes (immutable ImageAsset + cloneWithAttributes, node tree,
 * collections, plugin data, custom code). Used by Vitest and aliased over `@framer/plugin` in the
 * `e2e` Vite build so Playwright can drive the real plugin UI headlessly.
 */

export class FakeImageAsset {
  constructor(
    readonly id: string,
    readonly url: string,
    readonly altText: string | undefined,
  ) {}
  cloneWithAttributes({ altText }: { altText?: string }) {
    return new FakeImageAsset(this.id, this.url, altText ?? this.altText)
  }
}

export interface FakeNodeInit {
  id: string
  type: "FrameNode" | "TextNode" | "SVGNode" | "WebPageNode"
  name?: string | null
  parentId?: string | null
  backgroundImage?: FakeImageAsset | null
  backgroundColor?: string | null
  text?: string
  tag?: string
  color?: string
  fontSize?: string
  link?: string | null
  svg?: string
  width?: string
  height?: string
  path?: string
}

export interface FakeFramerState {
  nodes: Map<string, FakeNode>
  selection: string[]
  canvasRootId: string
  pluginData: Map<string, string>
  customCode: Record<string, string | null>
  notifications: Array<{ message: string; variant?: string }>
  addedSvgs: Array<{ svg: string; name?: string }>
  collections: FakeCollection[]
  managedCollections: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string }> }>
  setAttributeCalls: Array<{ id: string; attributes: Record<string, unknown> }>
}

export class FakeNode {
  readonly id: string
  readonly type: FakeNodeInit["type"]
  name: string | null
  parentId: string | null
  backgroundImage: FakeImageAsset | null
  backgroundColor: string | null
  link: string | null
  svg?: string
  width?: string
  height?: string
  path?: string
  inlineTextStyle?: { tag: string; color: string; fontSize?: string }
  private readonly text?: string
  pluginData = new Map<string, string>()
  getText?: () => Promise<string | null>

  constructor(
    private readonly state: FakeFramerState,
    init: FakeNodeInit,
  ) {
    this.id = init.id
    this.type = init.type
    this.name = init.name ?? null
    this.parentId = init.parentId ?? null
    this.backgroundImage = init.backgroundImage ?? null
    this.backgroundColor = init.backgroundColor ?? null
    this.link = init.link ?? null
    this.width = init.width
    this.height = init.height
    if (init.path !== undefined) this.path = init.path
    if (init.svg !== undefined) this.svg = init.svg
    if (init.type === "TextNode") {
      this.text = init.text ?? ""
      this.inlineTextStyle = { tag: init.tag ?? "p", color: init.color ?? "#000000", fontSize: init.fontSize }
      this.getText = async () => this.text ?? null
    }
  }

  async getParent() {
    return this.parentId ? (this.state.nodes.get(this.parentId) ?? null) : null
  }
  async getChildren() {
    return [...this.state.nodes.values()].filter((n) => n.parentId === this.id)
  }
  private descendants(): FakeNode[] {
    const out: FakeNode[] = []
    const visit = (id: string) => {
      for (const n of this.state.nodes.values()) {
        if (n.parentId === id) {
          out.push(n)
          visit(n.id)
        }
      }
    }
    visit(this.id)
    return out
  }
  async getNodesWithAttributeSet(attr: string) {
    return this.descendants().filter((n) => (n as unknown as Record<string, unknown>)[attr])
  }
  async getNodesWithType(type: string) {
    return this.descendants().filter((n) => n.type === type)
  }
  async setPluginData(key: string, value: string | null) {
    if (value === null) this.pluginData.delete(key)
    else this.pluginData.set(key, value)
  }
}

export class FakeCollectionItem {
  constructor(
    readonly id: string,
    readonly slug: string,
    public fieldData: Record<string, { type: string; value: unknown }>,
  ) {}
  async setAttributes(update: { fieldData?: Record<string, { type: string; value: unknown; alt?: string }> }) {
    for (const [fieldId, entry] of Object.entries(update.fieldData ?? {})) {
      if (entry.type === "image") {
        const current = this.fieldData[fieldId]?.value as FakeImageAsset | undefined
        this.fieldData[fieldId] = { type: "image", value: new FakeImageAsset(current?.id ?? fieldId, String(entry.value), entry.alt) }
      } else {
        this.fieldData[fieldId] = { type: entry.type, value: entry.value }
      }
    }
    return this
  }
}

export class FakeCollection {
  readonly managedBy = "user" as const
  constructor(
    readonly id: string,
    readonly name: string,
    readonly fields: Array<{ id: string; name: string; type: string }>,
    readonly items: FakeCollectionItem[],
  ) {}
  async getFields() {
    return this.fields
  }
  async getItems() {
    return this.items
  }
}

function svgDataUri(color: string, label: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="${color}"/><text x="60" y="46" font-size="12" fill="#fff" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`)}`
}

export function createFakeFramerState(): FakeFramerState {
  const state: FakeFramerState = {
    nodes: new Map(),
    selection: [],
    canvasRootId: "page-home",
    pluginData: new Map(),
    customCode: {},
    notifications: [],
    addedSvgs: [],
    collections: [],
    managedCollections: [],
    setAttributeCalls: [],
  }
  const add = (init: FakeNodeInit) => state.nodes.set(init.id, new FakeNode(state, init))
  add({ id: "page-home", type: "WebPageNode", name: "Home", path: "/" })
  add({ id: "hero", type: "FrameNode", name: "Hero", parentId: "page-home", backgroundColor: "#111111" })
  add({ id: "hero-title", type: "TextNode", name: "Hero title", parentId: "hero", text: "Specialty coffee, roasted daily", tag: "h1", color: "#ffffff", fontSize: "48px" })
  add({ id: "hero-sub", type: "TextNode", name: "Hero subtitle", parentId: "hero", text: "Small batches, big flavour", tag: "p", color: "#444444", fontSize: "16px" })
  add({ id: "hero-img", type: "FrameNode", name: "Barista pouring latte art", parentId: "hero", width: "800px", height: "500px", backgroundImage: new FakeImageAsset("a1", "https://framerusercontent.com/images/aBc9XyZ12qWeRtY7uIoP.jpg", undefined) })
  add({ id: "gallery", type: "FrameNode", name: "Gallery", parentId: "page-home", backgroundColor: "#ffffff" })
  add({ id: "g-caption", type: "TextNode", name: "Caption", parentId: "gallery", text: "Our roastery in the Mission district", tag: "p", color: "#555555", fontSize: "14px" })
  add({ id: "g-img", type: "FrameNode", name: "Image", parentId: "gallery", width: "400px", height: "300px", backgroundImage: new FakeImageAsset("a2", svgDataUri("#7a3cff", "roastery"), undefined) })
  add({ id: "logo", type: "FrameNode", name: "Logo", parentId: "page-home", width: "120px", height: "32px", backgroundImage: new FakeImageAsset("a3", svgDataUri("#222222", "logo"), "logo") })
  add({ id: "faq-h", type: "TextNode", name: "FAQ heading", parentId: "page-home", text: "Do you ship internationally?", tag: "h2", color: "#111111", fontSize: "24px" })
  add({ id: "faq-a", type: "TextNode", name: "FAQ answer", parentId: "page-home", text: "Yes, we ship to over forty countries and calculate duties at checkout.", tag: "p", color: "#333333", fontSize: "16px" })
  add({ id: "icon", type: "SVGNode", name: "Cup icon", parentId: "page-home", svg: `<?xml version="1.0"?><!-- Sketch --><svg xmlns="http://www.w3.org/2000/svg" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns" width="24px" height="24px"><desc>Created with Sketch.</desc><g><path d="M 4.000 6.000 L 18.000 6.000 L 16.500 18.000 Z" fill="#FFFFFF"/></g></svg>` })
  state.selection = ["hero"]
  state.collections = [
    new FakeCollection(
      "col-blog",
      "Blog",
      [
        { id: "title", name: "Title", type: "string" },
        { id: "cover", name: "Cover", type: "image" },
        { id: "meta", name: "Meta Description", type: "string" },
        { id: "body", name: "Content", type: "formattedText" },
      ],
      [
        new FakeCollectionItem("item-1", "pour-over-guide", {
          title: { type: "string", value: "The complete pour-over guide" },
          cover: { type: "image", value: new FakeImageAsset("c1", "https://framerusercontent.com/images/Qa71Kq0LmP2nB5vC7xQ.jpg", undefined) },
          meta: { type: "string", value: "" },
          body: { type: "formattedText", value: "<p>Pour-over brewing gives you control over extraction. Start with a medium-fine grind and water just off the boil.</p>" },
        }),
        new FakeCollectionItem("item-2", "espresso-basics", {
          title: { type: "string", value: "Espresso basics for beginners" },
          cover: { type: "image", value: new FakeImageAsset("c2", "https://framerusercontent.com/images/Pm41Kq0LmP2nB5vC7xQ.jpg", "") },
          meta: { type: "string", value: "" },
          body: { type: "formattedText", value: "<p>A good grinder matters more than an expensive machine. Dial in your grind until a double shot runs in about 28 seconds.</p>" },
        }),
      ],
    ),
  ]
  state.managedCollections = [{ id: "managed-1", name: "Synced products", fields: [{ id: "name", name: "Name", type: "string" }] }]
  return state
}

export function createFakeFramer(state: FakeFramerState = createFakeFramerState()) {
  const api = {
    state,
    async showUI() {},
    async getSelection() {
      return state.selection.map((id) => state.nodes.get(id)!).filter(Boolean)
    },
    subscribeToSelection(cb: (nodes: FakeNode[]) => void) {
      void api.getSelection().then(cb)
      return () => {}
    },
    async getCurrentUser() {
      return { id: "user-hash-123", name: "Ada Designer", initials: "AD", apiVersion1Id: "v1" }
    },
    async getProjectInfo() {
      return { id: "project-1", name: "Blue Door Coffee" }
    },
    async getCanvasRoot() {
      return state.nodes.get(state.canvasRootId)!
    },
    async getNode(id: string) {
      return state.nodes.get(id) ?? null
    },
    async setAttributes(id: string, attributes: Record<string, unknown>) {
      const node = state.nodes.get(id)
      if (!node) return null
      state.setAttributeCalls.push({ id, attributes })
      Object.assign(node, attributes)
      return node
    },
    async getNodesWithAttributeSet(attr: string) {
      return [...state.nodes.values()].filter((n) => (n as unknown as Record<string, unknown>)[attr])
    },
    async getCollections() {
      return state.collections
    },
    async getManagedCollections() {
      return state.managedCollections.map((m) => ({ ...m, getFields: async () => m.fields }))
    },
    async getPluginData(key: string) {
      return state.pluginData.get(key) ?? null
    },
    async setPluginData(key: string, value: string | null) {
      if (value === null) state.pluginData.delete(key)
      else state.pluginData.set(key, value)
    },
    async setCustomCode({ html, location }: { html: string | null; location: string }) {
      state.customCode[location] = html
    },
    async getCustomCode() {
      return state.customCode
    },
    async addSVG(svg: { svg: string; name?: string }) {
      state.addedSvgs.push(svg)
    },
    notify(message: string, options?: { variant?: string }) {
      state.notifications.push({ message, variant: options?.variant })
      return { close: () => {} }
    },
    isAllowedTo() {
      return true
    },
  }
  return api
}

/** Default export shape mirrors `import { framer } from "@framer/plugin"` for the e2e alias. */
export const framer = createFakeFramer()

if (typeof window !== "undefined") {
  ;(window as unknown as { __VSS_FAKE_FRAMER__: typeof framer }).__VSS_FAKE_FRAMER__ = framer
}
