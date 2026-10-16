import {
  browserStore,
  combineGraph,
  mapWithConcurrency,
  serializeJsonLd,
  toInjectorScript,
  toScriptTag,
  VSS_SCRIPT_ID,
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
import { WebflowCmsClient, type WebflowImageRef } from "./cms/webflowCmsClient.ts"

/** The slice of the Designer API used here, typed against the official typings. */
export type WebflowDesignerApi = Pick<
  WebflowApi,
  | "getSelectedElement"
  | "getAllElements"
  | "getAllAssets"
  | "getCurrentPage"
  | "getSiteInfo"
  | "getIdToken"
  | "getRootElement"
  | "elementPresets"
  | "notify"
  | "subscribe"
>

/* Duck-typed element surface (keeps the adapter testable without the Designer runtime). */
interface ElementLike {
  id: { component: string; element: string }
  type: string
  children?: boolean
  customAttributes?: boolean
  textContent?: boolean
  getChildren?: () => Promise<ElementLike[]>
  getAltText?: () => Promise<string | null>
  setAltText?: (alt: string | null) => Promise<null>
  getAsset?: () => Promise<AssetLike | null>
  getText?: () => Promise<string | null>
  getHeadingLevel?: () => Promise<number | null>
  getCustomAttribute?: (name: string) => Promise<string | null>
  setCustomAttribute?: (name: string, value: string) => Promise<null>
  getStyles?: () => Promise<Array<StyleLike | null> | null>
  getDisplayName?: () => Promise<string | null>
  setTag?: (tag: string) => Promise<null>
  getTag?: () => Promise<string | null>
  setAttribute?: (name: string, value: string) => Promise<null>
  getAttribute?: (name: string) => Promise<string | null>
  setTextContent?: (content: string) => Promise<null>
  remove?: () => Promise<null>
  append?: (preset: unknown) => Promise<ElementLike>
}
interface AssetLike {
  id: string
  getUrl(): Promise<string>
  getName(): Promise<string>
  getAltText(): Promise<string | null>
  setAltText(alt: string | null): Promise<null>
  getMimeType(): Promise<string>
}
interface StyleLike {
  getProperty(prop: string): Promise<unknown>
}

const elKey = (el: ElementLike) => `el:${el.id.component}:${el.id.element}`
const TEXT_TYPES = new Set(["Heading", "Paragraph", "TextBlock", "Blockquote", "RichText", "ListItem"])
const KEY_TOKEN = "vss:webflow-token"
const KEY_SITE_SCHEMA = "vss:schema:site"
const pageSchemaKey = (pageId: string) => `vss:schema:page:${pageId}`

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="))
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

function px(value: unknown): number | undefined {
  if (typeof value === "number") return value
  if (typeof value !== "string") return undefined
  const m = /^(\d+(\.\d+)?)px$/.exec(value.trim())
  return m ? Number(m[1]) : undefined
}

async function collectText(el: ElementLike, depth = 0): Promise<string> {
  if (el.getText) return (await el.getText()) ?? ""
  if (depth > 5 || !el.children || !el.getChildren) return ""
  const parts = await Promise.all((await el.getChildren()).map((c) => collectText(c, depth + 1)))
  return parts.join("").replace(/\s+/g, " ").trim()
}

async function styleValue(el: ElementLike, prop: string): Promise<string | null> {
  try {
    const styles = (await el.getStyles?.()) ?? []
    for (const s of styles) {
      const v = s ? await s.getProperty(prop) : null
      if (typeof v === "string" && v) return v
    }
  } catch {
    /* elements without styles */
  }
  return null
}

export interface WebflowAdapterOptions {
  /** Base URL for Data API calls (license worker proxy in production). */
  dataApiBaseUrl?: string
  fetch?: typeof fetch
  deviceStorage?: KeyValueStore
  clipboard?: (text: string) => Promise<boolean>
  ratePerMinute?: number
}

async function defaultClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function createWebflowAdapter(webflow: WebflowDesignerApi, options: WebflowAdapterOptions = {}): HostAdapter {
  const deviceStorage = options.deviceStorage ?? browserStore("vss-webflow")
  const clipboard = options.clipboard ?? defaultClipboard
  let siteIdPromise: Promise<string> | null = null
  const siteId = () => (siteIdPromise ??= webflow.getSiteInfo().then((s) => s.siteId))

  // Designer extensions have no project storage API: keep settings per site in localStorage.
  const siteStores = new Map<string, KeyValueStore>()
  const siteStore = async () => {
    const id = await siteId()
    let store = siteStores.get(id)
    if (!store) {
      store = browserStore(`vss-webflow:${id}`)
      siteStores.set(id, store)
    }
    return store
  }
  const projectStorage: KeyValueStore = {
    get: async (key) => (await siteStore()).get(key),
    set: async (key, value) => (await siteStore()).set(key, value),
  }

  let cmsClient: WebflowCmsClient | null = null
  let cmsToken: string | null = null
  async function cms(): Promise<WebflowCmsClient> {
    const token = await deviceStorage.get(KEY_TOKEN)
    if (!token) throw new Error("Add a Webflow site API token (CMS read & write) in Settings to use the CMS updater.")
    if (!cmsClient || token !== cmsToken) {
      cmsToken = token
      cmsClient = new WebflowCmsClient({
        token,
        ...(options.dataApiBaseUrl ? { baseUrl: options.dataApiBaseUrl } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.ratePerMinute ? { ratePerMinute: options.ratePerMinute } : {}),
      })
    }
    return cmsClient
  }

  const allElements = async () => (await webflow.getAllElements()) as unknown as ElementLike[]

  async function descendants(el: ElementLike, depth = 0): Promise<ElementLike[]> {
    if (depth > 12 || !el.children || !el.getChildren) return []
    const kids = await el.getChildren()
    const nested = await Promise.all(kids.map((k) => descendants(k, depth + 1)))
    return [...kids, ...nested.flat()]
  }

  async function elementsInScope(scope: ImageScope): Promise<ElementLike[]> {
    if (scope === "selection") {
      const selected = (await webflow.getSelectedElement()) as unknown as ElementLike | null
      return selected ? [selected, ...(await descendants(selected))] : []
    }
    return allElements()
  }

  async function findElement(key: string): Promise<ElementLike | null> {
    const [, component, element] = key.split(":")
    return (await allElements()).find((e) => e.id.component === component && e.id.element === element) ?? null
  }

  async function currentPage() {
    return webflow.getCurrentPage()
  }

  const adapter: HostAdapter = {
    name: "webflow",
    displayName: "Webflow",
    capabilities: { selection: true, setPageMeta: true, cms: true, headCode: true, svg: false, auditFixes: true },
    settingsFields: [
      {
        key: KEY_TOKEN,
        label: "Webflow site API token",
        secret: true,
        placeholder: "Site settings › Apps & integrations › API access",
        help: "Needed only for CMS bulk updates (scopes: CMS read & write). Stored on this device; requests go through our proxy only because Webflow's API blocks browser calls.",
      },
    ],
    projectStorage,
    deviceStorage,

    async getUser() {
      try {
        const payload = decodeJwtPayload(await webflow.getIdToken())
        const user = payload?.user as { id?: string } | undefined
        const id = user?.id ?? (payload?.sub as string | undefined)
        if (id) return { id }
      } catch {
        /* id tokens need app permissions; fall back to the site */
      }
      return { id: `site:${await siteId()}` }
    },

    async listImages(scope) {
      if (scope === "project") {
        const assets = (await webflow.getAllAssets()) as unknown as AssetLike[]
        const images: HostImage[] = []
        await mapWithConcurrency(assets, 6, async (asset) => {
          const mime = await asset.getMimeType()
          if (!mime.startsWith("image/")) return
          const [url, name, alt] = await Promise.all([asset.getUrl(), asset.getName(), asset.getAltText()])
          images.push({ id: `asset:${asset.id}`, src: url, filename: name, name, alt, location: "Assets panel (site-wide)" })
        })
        return images
      }
      const page = await currentPage()
      const pageName = await page.getName()
      const elements = (await elementsInScope(scope)).filter((e) => e.type === "Image")
      return mapWithConcurrency(elements, 6, async (el): Promise<HostImage> => {
        const asset = (await el.getAsset?.()) ?? null
        const [alt, url, name, display] = await Promise.all([
          el.getAltText?.() ?? null,
          asset?.getUrl() ?? "",
          asset?.getName() ?? null,
          el.getDisplayName?.().catch(() => null) ?? null,
        ])
        return { id: elKey(el), src: url, alt: alt || null, filename: name, name: display ?? name, location: pageName, pageTitle: pageName }
      })
    },

    async applyAltText(updates: AltTextUpdate[], onProgress): Promise<ApplyResult> {
      const failed: ApplyResult["failed"] = []
      let done = 0
      const assets = updates.some((u) => u.id.startsWith("asset:")) ? ((await webflow.getAllAssets()) as unknown as AssetLike[]) : []
      const elements = updates.some((u) => u.id.startsWith("el:")) ? await allElements() : []
      for (const u of updates) {
        try {
          const alt = u.decorative ? "" : u.alt
          if (u.id.startsWith("asset:")) {
            const asset = assets.find((a) => `asset:${a.id}` === u.id)
            if (!asset) throw new Error("Asset not found")
            await asset.setAltText(alt)
          } else {
            const [, component, element] = u.id.split(":")
            const el = elements.find((e) => e.id.component === component && e.id.element === element)
            if (!el?.setAltText) throw new Error("Image element not found")
            await el.setAltText(alt)
          }
        } catch (error) {
          failed.push({ id: u.id, error: error instanceof Error ? error.message : String(error) })
        }
        onProgress?.(++done, updates.length)
      }
      return { updated: updates.length - failed.length, failed }
    },

    async getPageInfo(): Promise<PageInfo> {
      const [page, site] = await Promise.all([currentPage(), webflow.getSiteInfo()])
      const [title, description, slug] = await Promise.all([page.getTitle(), page.getDescription(), page.getSlug()])
      const elements = (await allElements()).filter((e) => TEXT_TYPES.has(e.type))
      const headings: string[] = []
      const body: string[] = []
      const sections: Array<{ heading: string; text: string }> = []
      for (const el of elements.slice(0, 300)) {
        const text = await collectText(el)
        if (!text) continue
        if (el.type === "Heading") {
          headings.push(text)
          sections.push({ heading: text, text: "" })
        } else {
          body.push(text)
          const last = sections[sections.length - 1]
          if (last) last.text = `${last.text} ${text}`.trim()
        }
      }
      const domain = site.domains.find((d) => d.default)?.url ?? site.domains[0]?.url ?? `${site.shortName}.webflow.io`
      const base = domain.startsWith("http") ? domain : `https://${domain}`
      return {
        id: page.id,
        title: title || (await page.getName()),
        description,
        url: `${base.replace(/\/$/, "")}/${slug === "index" ? "" : slug}`,
        headings,
        bodyText: body.join(" "),
        sections,
        brand: site.siteName,
      }
    },

    async setPageMeta(meta) {
      const page = await currentPage()
      if (meta.title !== undefined) await page.setTitle(meta.title)
      if (meta.description !== undefined) await page.setDescription(meta.description)
    },

    async collectAuditNodes(scope) {
      const elements = await elementsInScope(scope === "project" ? "page" : scope)
      const nodes: AuditNode[] = []
      await mapWithConcurrency(elements, 6, async (el) => {
        const id = elKey(el)
        const name = (await el.getDisplayName?.().catch(() => null)) ?? el.type
        if (TEXT_TYPES.has(el.type)) {
          const text = await collectText(el)
          if (!text) return
          const [color, background, fontSize, fontWeight, level] = await Promise.all([
            styleValue(el, "color"),
            styleValue(el, "background-color"),
            styleValue(el, "font-size"),
            styleValue(el, "font-weight"),
            el.getHeadingLevel?.() ?? null,
          ])
          nodes.push({
            kind: "text",
            id,
            name,
            text,
            color: color ?? "#333333",
            background,
            fontSizePx: px(fontSize),
            fontWeight: fontWeight ? Number(fontWeight) || undefined : undefined,
            tag: level ? `h${level}` : "p",
          })
        } else if (el.type === "Image") {
          const asset = (await el.getAsset?.()) ?? null
          const [alt, src, filename] = await Promise.all([el.getAltText?.() ?? null, asset?.getUrl() ?? null, asset?.getName() ?? null])
          nodes.push({ kind: "image", id, name, alt, src, filename })
        } else if (el.type === "Link" || el.type === "LinkBlock" || el.type === "Button") {
          const [text, aria] = await Promise.all([collectText(el), el.getCustomAttribute?.("aria-label") ?? null])
          nodes.push({ kind: el.type === "Button" ? "button" : "link", id, name, text, ariaLabel: aria })
        }
      })
      const page = await currentPage()
      return { nodes, page: { title: await page.getTitle(), description: await page.getDescription() } }
    },

    async applyAuditFix(issue: AuditIssue) {
      if (!issue.nodeId || !issue.fix) return false
      const el = await findElement(issue.nodeId)
      if (!el) return false
      if (issue.fix.type === "alt" && el.setAltText) {
        await el.setAltText(issue.fix.decorative ? "" : issue.fix.value)
        return true
      }
      if (issue.fix.type === "aria-label" && el.customAttributes && el.setCustomAttribute) {
        await el.setCustomAttribute("aria-label", issue.fix.value)
        return true
      }
      // Colors live in shared classes; changing them would restyle every element using the class.
      return false
    },

    async listCollections() {
      const client = await cms()
      const collections = await client.listCollections(await siteId())
      return mapWithConcurrency(collections, 3, async (c): Promise<CmsCollection> => {
        const full = c.fields ? c : await client.getCollection(c.id)
        const fields: CmsField[] = (full.fields ?? []).map((f) => ({
          id: f.slug,
          slug: f.slug,
          name: f.displayName,
          type: f.type === "PlainText" ? "text" : f.type === "RichText" ? "richtext" : f.type === "Image" ? "image" : "other",
        }))
        return { id: c.id, name: c.displayName, fields }
      })
    },

    async listCollectionItems(collectionId) {
      const client = await cms()
      const items = await client.listItems(collectionId)
      return items.map((item): CmsItem => {
        const fieldData: CmsItem["fieldData"] = {}
        for (const [slug, value] of Object.entries(item.fieldData)) {
          if (typeof value === "string") fieldData[slug] = value
          else if (value && typeof value === "object" && "url" in value) {
            const img = value as WebflowImageRef
            fieldData[slug] = { url: img.url, alt: img.alt ?? null }
          }
        }
        return { id: item.id, slug: item.fieldData.slug, title: String(item.fieldData.name ?? item.fieldData.slug ?? item.id), fieldData }
      })
    },

    async updateCollectionItems(collectionId, updates: CmsUpdate[], onProgress, signal) {
      const client = await cms()
      const needsImages = updates.some((u) => u.kind === "image-alt")
      const current = needsImages ? new Map((await client.listItems(collectionId, signal)).map((i) => [i.id, i])) : new Map()
      // Merge multiple field updates for the same item into one PATCH payload.
      const byItem = new Map<string, Record<string, unknown>>()
      for (const u of updates) {
        const fieldData = byItem.get(u.itemId) ?? {}
        if (u.kind === "text") fieldData[u.fieldId] = u.value
        else {
          const img = current.get(u.itemId)?.fieldData[u.fieldId] as WebflowImageRef | undefined
          if (img) fieldData[u.fieldId] = { ...(img.fileId ? { fileId: img.fileId } : {}), url: img.url, alt: u.value }
        }
        byItem.set(u.itemId, fieldData)
      }
      const payload = [...byItem.entries()].filter(([, fd]) => Object.keys(fd).length > 0).map(([id, fieldData]) => ({ id, fieldData }))
      const skipped = updates.filter((u) => !payload.some((p) => p.id === u.itemId)).map((u) => ({ id: u.itemId, error: "Item has no image to update" }))
      const res = await client.updateItems(collectionId, payload, {
        ...(onProgress ? { onProgress } : {}),
        ...(signal ? { signal } : {}),
        onRateLimited: ({ retryAfterMs }) => adapter.notify(`Webflow rate limit reached — resuming in ${Math.ceil(retryAfterMs / 1000)}s`, "info"),
      })
      return { updated: res.updated, failed: [...res.failed, ...skipped] }
    },

    async getStructuredData(target: StructuredDataTarget) {
      const key = target === "site" ? KEY_SITE_SCHEMA : pageSchemaKey((await currentPage()).id)
      const raw = await projectStorage.get(key)
      try {
        return raw ? (JSON.parse(raw) as JsonLdObject[]) : []
      } catch {
        return []
      }
    },

    async saveStructuredData(objects: JsonLdObject[], target: StructuredDataTarget) {
      const page = await currentPage()
      const key = target === "site" ? KEY_SITE_SCHEMA : pageSchemaKey(page.id)
      await projectStorage.set(key, objects.length ? JSON.stringify(objects) : null)
      const graph = objects.length ? combineGraph(objects) : null

      if (target === "page") {
        // Designer API: maintain a <script type="application/ld+json"> custom element on the page.
        try {
          let scriptEl: ElementLike | null = null
          for (const e of (await allElements()).filter((x) => x.type === "DOM")) {
            if ((await e.getAttribute?.("id")) === VSS_SCRIPT_ID) {
              scriptEl = e
              break
            }
          }
          if (!graph) {
            await scriptEl?.remove?.()
            return { method: "webflow DOM element", message: "Page schema removed." }
          }
          if (!scriptEl) {
            const root = (await webflow.getRootElement()) as unknown as ElementLike | null
            if (!root?.append) throw new Error("Page has no root element")
            scriptEl = await root.append(webflow.elementPresets.DOM)
            await scriptEl.setTag!("script")
            await scriptEl.setAttribute!("id", VSS_SCRIPT_ID)
            await scriptEl.setAttribute!("type", "application/ld+json")
          }
          await scriptEl.setTextContent!(serializeJsonLd(graph))
          return { method: "webflow DOM element", message: "JSON-LD added to this page. Publish to go live." }
        } catch {
          /* fall through to copy/paste */
        }
      } else if (graph) {
        // Site-wide head code via the Data API (needs an app token with custom_code:write).
        try {
          const client = await cms()
          const source = toInjectorScript(graph)
          await client.upsertHeadScript({ siteId: await siteId(), sourceCode: source, displayName: "Visual SEO Schema", version: `1.0.${Date.now()}` })
          return { method: "webflow custom code API", message: "Schema registered in the site <head>. Publish to go live." }
        } catch {
          /* fall through to copy/paste */
        }
      }
      if (!graph) return { method: "storage", message: "Schema removed." }
      const copied = await clipboard(toScriptTag(graph))
      const where = target === "site" ? "Site settings › Custom code › Head code" : "Page settings › Custom code › Inside <head> tag"
      return { method: "clipboard", message: copied ? `Copied! Paste into ${where}, then publish.` : `Saved. Use “Copy <script>” and paste into ${where}.` }
    },

    notify(message, variant = "info") {
      const type = variant === "success" ? "Success" : variant === "error" ? "Error" : variant === "warning" ? "Warning" : "Info"
      void webflow.notify({ type, message })
    },

    subscribeToSelection(callback) {
      return webflow.subscribe("selectedelement", () => callback())
    },
  }
  return adapter
}
