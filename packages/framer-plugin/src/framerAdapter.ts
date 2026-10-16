import type { framer as FramerInstance } from "@framer/plugin"
import {
  browserStore,
  combineGraph,
  mapWithConcurrency,
  toScriptTag,
  type AltTextUpdate,
  type ApplyResult,
  type AuditIssue,
  type AuditNode,
  type CmsCollection,
  type CmsField,
  type CmsItem,
  type CmsUpdate,
  type HostAdapter,
  type HostImage,
  type ImageScope,
  type JsonLdObject,
  type KeyValueStore,
  type PageInfo,
  type StructuredDataTarget,
} from "@vss/core-engine"

/**
 * The slice of the Framer Plugin API this adapter uses. Typed against the real SDK so renames break
 * the build; tests pass an in-memory fake cast to this type.
 */
export type FramerApi = Pick<
  typeof FramerInstance,
  | "getSelection"
  | "subscribeToSelection"
  | "getCurrentUser"
  | "getProjectInfo"
  | "getCanvasRoot"
  | "getNode"
  | "setAttributes"
  | "getNodesWithAttributeSet"
  | "getCollections"
  | "getManagedCollections"
  | "getPluginData"
  | "setPluginData"
  | "setCustomCode"
  | "getCustomCode"
  | "addSVG"
  | "notify"
  | "isAllowedTo"
>

/* Duck-typed node helpers (avoid importing runtime guards so the adapter stays testable in Node). */
interface ImageLike {
  url: string
  altText?: string | undefined
  cloneWithAttributes(attrs: { altText?: string }): unknown
}
interface NodeLike {
  id: string
  name?: string | null
  backgroundImage?: ImageLike | null
  backgroundColor?: string | { light: string; dark?: string | null } | null
  link?: string | null
  svg?: string
  path?: string | null
  inlineTextStyle?: { tag?: string; color?: string | { light: string }; fontSize?: string | number } | null
  width?: string | number | null
  height?: string | number | null
  getText?: () => Promise<string | null>
  getParent?: () => Promise<NodeLike | null>
  getChildren?: () => Promise<NodeLike[]>
  getNodesWithAttributeSet?: (attr: string) => Promise<NodeLike[]>
  getNodesWithType?: (type: string) => Promise<NodeLike[]>
  setPluginData?: (key: string, value: string | null) => Promise<void>
}

const asNode = (n: unknown) => n as NodeLike
const hasImage = (n: NodeLike): n is NodeLike & { backgroundImage: ImageLike } => !!n.backgroundImage && typeof n.backgroundImage.url === "string"
const isText = (n: NodeLike) => typeof n.getText === "function"

function colorValue(c: NodeLike["backgroundColor"] | undefined): string | null {
  if (!c) return null
  if (typeof c === "string") return c
  return c.light ?? null
}

function px(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "number") return value
  const m = /^(-?\d+(\.\d+)?)px$/.exec(value.trim())
  return m ? Number(m[1]) : undefined
}

const KEY_SITE_SCHEMA = "vss:schema:site"
const pageSchemaKey = (pageId: string) => `vss:schema:page:${pageId}`
const MAX_CONTEXT_LOOKUPS = 150

export interface FramerAdapterOptions {
  /** Override device storage (tests). */
  deviceStorage?: KeyValueStore
  clipboard?: (text: string) => Promise<boolean>
}

async function defaultClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function createFramerAdapter(framer: FramerApi, options: FramerAdapterOptions = {}): HostAdapter {
  const clipboard = options.clipboard ?? defaultClipboard

  const projectStorage: KeyValueStore = {
    get: (key) => framer.getPluginData(key),
    set: (key, value) => framer.setPluginData(key, value),
  }

  async function nodesInScope(scope: ImageScope, attribute: "backgroundImage"): Promise<NodeLike[]> {
    if (scope === "project") return (await framer.getNodesWithAttributeSet(attribute)).map(asNode)
    if (scope === "page") {
      const root = asNode(await framer.getCanvasRoot())
      return root.getNodesWithAttributeSet ? await root.getNodesWithAttributeSet(attribute) : []
    }
    const selection = (await framer.getSelection()).map(asNode)
    const out: NodeLike[] = []
    for (const node of selection) {
      if (hasImage(node)) out.push(node)
      if (node.getNodesWithAttributeSet) out.push(...(await node.getNodesWithAttributeSet(attribute)))
    }
    return out
  }

  async function textNodesInScope(scope: ImageScope): Promise<NodeLike[]> {
    if (scope === "selection") {
      const selection = (await framer.getSelection()).map(asNode)
      const out: NodeLike[] = []
      for (const node of selection) {
        if (isText(node)) out.push(node)
        if (node.getNodesWithType) out.push(...(await node.getNodesWithType("TextNode")))
      }
      return out
    }
    const root = asNode(await framer.getCanvasRoot())
    return root.getNodesWithType ? await root.getNodesWithType("TextNode") : []
  }

  /** Caption-like text next to an image: the first text sibling. */
  async function nearbyText(node: NodeLike): Promise<string | null> {
    try {
      const parent = node.getParent ? await node.getParent() : null
      const siblings = parent?.getChildren ? await parent.getChildren() : []
      for (const s of siblings) {
        if (s.id !== node.id && isText(s)) {
          const text = await s.getText!()
          if (text && text.trim()) return text.trim().slice(0, 300)
        }
      }
    } catch {
      /* context is best-effort */
    }
    return null
  }

  /** Nearest ancestor background color, for contrast checks. */
  async function effectiveBackground(node: NodeLike): Promise<string | null> {
    let current: NodeLike | null = node
    for (let depth = 0; current && depth < 12; depth++) {
      const parent: NodeLike | null = current.getParent ? await current.getParent() : null
      if (!parent) return "#ffffff" // Framer pages default to white
      if (parent.backgroundImage) return null // text over an image: unknown
      const bg = colorValue(parent.backgroundColor)
      if (bg && !/^rgba?\(.*,\s*0\)$/.test(bg) && bg !== "transparent") return bg
      current = parent
    }
    return null
  }

  async function currentPageId(): Promise<string> {
    const root = asNode(await framer.getCanvasRoot())
    return root.id
  }

  const adapter: HostAdapter = {
    name: "framer",
    displayName: "Framer",
    capabilities: { selection: true, setPageMeta: false, cms: true, headCode: true, svg: true, auditFixes: true },
    projectStorage,
    deviceStorage: options.deviceStorage ?? browserStore("vss-framer"),

    async getUser() {
      const user = await framer.getCurrentUser()
      return { id: user.id, name: user.name }
    },

    async listImages(scope) {
      const nodes = await nodesInScope(scope, "backgroundImage")
      const unique = [...new Map(nodes.filter(hasImage).map((n) => [n.id, n])).values()]
      const withContext = unique.length <= MAX_CONTEXT_LOOKUPS
      return mapWithConcurrency(unique, 6, async (node): Promise<HostImage> => ({
        id: node.id,
        src: node.backgroundImage.url,
        alt: node.backgroundImage.altText ?? null,
        name: node.name ?? null,
        nearbyText: withContext ? await nearbyText(node) : null,
        width: px(node.width),
        height: px(node.height),
        linkHref: node.link ?? null,
      }))
    },

    async applyAltText(updates: AltTextUpdate[], onProgress): Promise<ApplyResult> {
      const failed: ApplyResult["failed"] = []
      let done = 0
      for (const update of updates) {
        try {
          const node = asNode(await framer.getNode(update.id))
          if (!node || !hasImage(node)) throw new Error("Layer no longer has an image")
          const image = node.backgroundImage.cloneWithAttributes({ altText: update.decorative ? "" : update.alt })
          await framer.setAttributes(update.id, { backgroundImage: image } as never)
          await node.setPluginData?.("vss:alt", update.decorative ? "decorative" : "generated")
        } catch (error) {
          failed.push({ id: update.id, error: error instanceof Error ? error.message : String(error) })
        }
        onProgress?.(++done, updates.length)
      }
      return { updated: updates.length - failed.length, failed }
    },

    async getPageInfo(): Promise<PageInfo> {
      const [project, root] = await Promise.all([framer.getProjectInfo(), framer.getCanvasRoot()])
      const page = asNode(root)
      const texts = (page.getNodesWithType ? await page.getNodesWithType("TextNode") : []).slice(0, 300)
      const headings: string[] = []
      const body: string[] = []
      const sections: Array<{ heading: string; text: string }> = []
      for (const node of texts) {
        const text = (await node.getText?.())?.trim()
        if (!text) continue
        const tag = node.inlineTextStyle?.tag ?? "p"
        if (/^h[1-6]$/.test(tag)) {
          headings.push(text)
          sections.push({ heading: text, text: "" })
        } else {
          body.push(text)
          const last = sections[sections.length - 1]
          if (last) last.text = `${last.text} ${text}`.trim()
        }
      }
      const path = page.path ?? null
      return {
        id: page.id,
        title: headings[0] ?? project.name,
        description: null,
        url: path,
        headings,
        bodyText: body.join(" "),
        sections,
        brand: project.name,
      }
    },

    async collectAuditNodes(scope) {
      const auditScope = scope === "project" ? "page" : scope
      const nodes: AuditNode[] = []
      const texts = (await textNodesInScope(auditScope)).slice(0, 400)
      await mapWithConcurrency(texts, 6, async (t) => {
        const text = (await t.getText?.()) ?? ""
        const style = t.inlineTextStyle
        const color = typeof style?.color === "string" ? style.color : (style?.color?.light ?? "#000000")
        const fontSize = typeof style?.fontSize === "number" ? style.fontSize : px(style?.fontSize as string | undefined)
        const base = { id: t.id, name: t.name ?? null, text }
        if (t.link) nodes.push({ kind: "link", ...base, href: t.link, color, background: await effectiveBackground(t), fontSizePx: fontSize })
        else nodes.push({ kind: "text", ...base, color, background: await effectiveBackground(t), fontSizePx: fontSize, tag: style?.tag })
      })
      const images = await adapter.listImages(auditScope)
      for (const img of images) nodes.push({ kind: "image", id: img.id, name: img.name, src: img.src, alt: img.alt, nearbyText: img.nearbyText, width: img.width, height: img.height, linkHref: img.linkHref })
      return { nodes }
    },

    async applyAuditFix(issue: AuditIssue) {
      if (!issue.nodeId || !issue.fix) return false
      if (issue.fix.type === "alt") {
        const res = await adapter.applyAltText([{ id: issue.nodeId, alt: issue.fix.value, decorative: issue.fix.decorative }])
        return res.updated === 1
      }
      // Text colors live in shared text styles; changing them silently would restyle other layers.
      return false
    },

    async listCollections() {
      const [collections, managed] = await Promise.all([framer.getCollections(), framer.getManagedCollections().catch(() => [])])
      const mapField = (f: { id: string; name: string; type: string }): CmsField => ({
        id: f.id,
        name: f.name,
        type: f.type === "string" ? "text" : f.type === "formattedText" ? "richtext" : f.type === "image" ? "image" : "other",
      })
      const out: CmsCollection[] = []
      for (const c of collections) {
        const fields = await c.getFields()
        out.push({ id: c.id, name: c.name, fields: fields.map((f) => mapField(f as { id: string; name: string; type: string })), readOnly: c.managedBy !== "user" })
      }
      const managedIds = new Set(out.map((c) => c.id))
      for (const m of managed) {
        if (managedIds.has(m.id)) continue
        const fields = await m.getFields()
        // Plugin-managed collections are synced from their source; we show them but don't edit items.
        out.push({ id: m.id, name: `${m.name} (managed)`, fields: fields.map((f) => mapField(f as unknown as { id: string; name: string; type: string })), readOnly: true })
      }
      return out
    },

    async listCollectionItems(collectionId) {
      const collection = (await framer.getCollections()).find((c) => c.id === collectionId)
      if (!collection) return []
      const items = await collection.getItems()
      return items.map((item): CmsItem => {
        const fieldData: CmsItem["fieldData"] = {}
        let title: string | null = null
        for (const [fieldId, entry] of Object.entries(item.fieldData)) {
          const e = entry as { type: string; value: unknown }
          if (e.type === "string" || e.type === "formattedText") {
            fieldData[fieldId] = String(e.value ?? "")
            if (!title && e.type === "string" && e.value) title = String(e.value)
          } else if (e.type === "image") {
            const img = e.value as ImageLike | undefined
            fieldData[fieldId] = img ? { url: img.url, alt: img.altText ?? null } : null
          }
        }
        return { id: item.id, slug: item.slug, title: title ?? item.slug, fieldData }
      })
    },

    async updateCollectionItems(collectionId, updates: CmsUpdate[], onProgress, signal) {
      const collection = (await framer.getCollections()).find((c) => c.id === collectionId)
      if (!collection) throw new Error("Collection not found")
      const items = new Map((await collection.getItems()).map((i) => [i.id, i]))
      const failed: ApplyResult["failed"] = []
      let done = 0
      // Framer applies CMS writes locally (no HTTP rate limit) — run sequentially so undo stays sane.
      for (const u of updates) {
        if (signal?.aborted) {
          failed.push({ id: u.itemId, error: "Cancelled" })
          continue
        }
        try {
          const item = items.get(u.itemId)
          if (!item) throw new Error("Item not found")
          let entry: Record<string, unknown>
          if (u.kind === "text") entry = { type: "string", value: u.value }
          else {
            const current = (item.fieldData[u.fieldId] as { value?: ImageLike } | undefined)?.value
            if (!current) throw new Error("Item has no image")
            entry = { type: "image", value: current.url, alt: u.value }
          }
          await item.setAttributes({ fieldData: { [u.fieldId]: entry } } as never)
        } catch (error) {
          failed.push({ id: u.itemId, error: error instanceof Error ? error.message : String(error) })
        }
        onProgress?.(++done, updates.length)
      }
      return { updated: updates.length - failed.length, failed }
    },

    async getStructuredData(target: StructuredDataTarget) {
      const key = target === "site" ? KEY_SITE_SCHEMA : pageSchemaKey(await currentPageId())
      const raw = await framer.getPluginData(key)
      try {
        return raw ? (JSON.parse(raw) as JsonLdObject[]) : []
      } catch {
        return []
      }
    },

    async saveStructuredData(objects: JsonLdObject[], target: StructuredDataTarget) {
      const key = target === "site" ? KEY_SITE_SCHEMA : pageSchemaKey(await currentPageId())
      await framer.setPluginData(key, objects.length ? JSON.stringify(objects) : null)
      const html = objects.length ? toScriptTag(combineGraph(objects)) : null
      if (target === "site") {
        // One slot per location: all site-wide schema is merged into a single @graph script.
        await framer.setCustomCode({ html, location: "headEnd" })
        return {
          method: "framer.setCustomCode(headEnd)",
          message: objects.length ? `Site head updated with ${objects.length} schema block${objects.length === 1 ? "" : "s"}. Publish to go live.` : "Site schema removed.",
        }
      }
      const copied = html ? await clipboard(html) : false
      return {
        method: "clipboard",
        message: copied
          ? "Copied! Paste into this page's Settings › Custom Code › End of <head>, then publish."
          : "Saved. Use “Copy <script>” and paste into Page Settings › Custom Code.",
      }
    },

    async getSelectedSvg() {
      const selection = (await framer.getSelection()).map(asNode)
      const svgNode = selection.find((n) => typeof n.svg === "string")
      return svgNode ? { svg: svgNode.svg!, name: svgNode.name ?? null } : null
    },

    async insertSvg(svg, name) {
      await framer.addSVG({ svg, name })
    },

    notify(message, variant = "info") {
      void framer.notify(message.slice(0, 120), { variant })
    },

    subscribeToSelection(callback) {
      return framer.subscribeToSelection(() => callback())
    },
  }
  return adapter
}
