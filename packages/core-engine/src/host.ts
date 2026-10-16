import type { AuditIssue, AuditNode, PageMeta } from "./contrast/audit.ts"
import type { JsonLdObject } from "./schema/build.ts"
import type { ContentSection } from "./schema/html.ts"

/**
 * The contract every host (Framer, Webflow, playground) implements. The shared UI only talks to
 * this interface, so features are written once and adapters stay thin.
 */

export type HostName = "framer" | "webflow" | "playground"

export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string | null): Promise<void>
}

export type ImageScope = "selection" | "page" | "project"

export interface HostImage {
  /** Adapter-specific opaque id (node id, asset id, `cms:<collection>:<item>:<field>`). */
  id: string
  src: string
  alt: string | null
  /** Layer / element display name. */
  name?: string | null
  filename?: string | null
  width?: number | null
  height?: number | null
  nearbyText?: string | null
  pageTitle?: string | null
  collectionItemTitle?: string | null
  linkHref?: string | null
  /** Where this image lives, for display ("Home / Hero", "Assets"). */
  location?: string | null
}

export interface AltTextUpdate {
  id: string
  alt: string
  decorative?: boolean
}

export interface ApplyResult {
  updated: number
  failed: Array<{ id: string; error: string }>
}

export type ProgressCallback = (done: number, total: number) => void

export interface PageInfo {
  id?: string | null
  title: string
  description?: string | null
  url?: string | null
  lang?: string | null
  headings: string[]
  bodyText: string
  sections?: ContentSection[]
  brand?: string | null
}

export interface CmsField {
  id: string
  name: string
  slug?: string
  type: "text" | "richtext" | "image" | "other"
}

export interface CmsCollection {
  id: string
  name: string
  fields: CmsField[]
  itemCount?: number
  readOnly?: boolean
}

export interface CmsImageValue {
  url: string
  alt: string | null
}

export interface CmsItem {
  id: string
  title: string
  slug?: string
  /** Values keyed by field id. Text → string, image → CmsImageValue. */
  fieldData: Record<string, string | CmsImageValue | null | undefined>
}

export type CmsUpdate =
  | { itemId: string; fieldId: string; kind: "text"; value: string }
  | { itemId: string; fieldId: string; kind: "image-alt"; value: string }

/** "site" = every page (global head code); "page" = the current page only. */
export type StructuredDataTarget = "site" | "page"

export interface StructuredDataResult {
  /** e.g. "framer.setCustomCode(headEnd)", "webflow DOM element", "clipboard" */
  method: string
  message: string
}

export interface SelectedSvg {
  svg: string
  name?: string | null
}

export interface HostCapabilities {
  selection: boolean
  setPageMeta: boolean
  cms: boolean
  headCode: boolean
  svg: boolean
  auditFixes: boolean
}

export type NotifyVariant = "info" | "success" | "warning" | "error"

export interface HostAdapter {
  readonly name: HostName
  readonly displayName: string
  readonly capabilities: HostCapabilities
  getUser(): Promise<{ id: string; name?: string | null }>
  /** Project/site-scoped storage (Framer plugin data, Webflow localStorage keyed by site). */
  projectStorage: KeyValueStore
  /** Device-scoped storage for secrets such as BYO AI keys — never synced to collaborators. */
  deviceStorage: KeyValueStore

  listImages(scope: ImageScope): Promise<HostImage[]>
  applyAltText(updates: AltTextUpdate[], onProgress?: ProgressCallback): Promise<ApplyResult>

  getPageInfo(): Promise<PageInfo>
  setPageMeta?(meta: { title?: string; description?: string }): Promise<void>

  collectAuditNodes(scope: ImageScope): Promise<{ nodes: AuditNode[]; page?: PageMeta }>
  applyAuditFix?(issue: AuditIssue): Promise<boolean>

  listCollections?(): Promise<CmsCollection[]>
  listCollectionItems?(collectionId: string): Promise<CmsItem[]>
  updateCollectionItems?(
    collectionId: string,
    updates: CmsUpdate[],
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
  ): Promise<ApplyResult>

  getStructuredData(target: StructuredDataTarget): Promise<JsonLdObject[]>
  saveStructuredData(objects: JsonLdObject[], target: StructuredDataTarget): Promise<StructuredDataResult>

  getSelectedSvg?(): Promise<SelectedSvg | null>
  insertSvg?(svg: string, name: string): Promise<void>

  notify(message: string, variant?: NotifyVariant): void
  subscribeToSelection?(callback: () => void): () => void
}

/** In-memory store, used by tests and as a fallback when storage is unavailable. */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(initial))
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      if (value === null) map.delete(key)
      else map.set(key, value)
    },
  }
}

/** localStorage-backed store with a namespace; falls back to memory when blocked (sandboxed iframes). */
export function browserStore(namespace: string): KeyValueStore {
  const fallback = memoryStore()
  const ls = (): Storage | null => {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null
    } catch {
      return null
    }
  }
  return {
    async get(key) {
      try {
        const s = ls()
        return s ? s.getItem(`${namespace}:${key}`) : fallback.get(key)
      } catch {
        return fallback.get(key)
      }
    },
    async set(key, value) {
      try {
        const s = ls()
        if (!s) return fallback.set(key, value)
        if (value === null) s.removeItem(`${namespace}:${key}`)
        else s.setItem(`${namespace}:${key}`, value)
      } catch {
        await fallback.set(key, value)
      }
    },
  }
}
