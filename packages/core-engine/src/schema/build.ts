import {
  NESTED_TYPES,
  SCHEMA_DEFINITIONS,
  type FieldDef,
  type SchemaFormData,
  type SchemaFormValue,
  type SchemaType,
} from "./definitions.ts"

export type JsonLdValue = string | number | boolean | null | JsonLdObject | JsonLdValue[]
export interface JsonLdObject {
  [key: string]: JsonLdValue
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "string") return value.trim() === ""
  if (typeof value === "number") return Number.isNaN(value)
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === "object") {
    return Object.keys(value as object).filter((k) => k !== "@type").length === 0
  }
  return false
}

/** Recursively remove empty strings, nulls, empty arrays and objects that only have an @type. */
export function pruneEmpty<T extends JsonLdValue>(value: T): T | undefined {
  if (Array.isArray(value)) {
    const arr = value.map((v) => pruneEmpty(v)).filter((v): v is JsonLdValue => v !== undefined && !isEmpty(v))
    return (arr.length ? arr : undefined) as T | undefined
  }
  if (value && typeof value === "object") {
    const out: JsonLdObject = {}
    for (const [k, v] of Object.entries(value)) {
      const pruned = pruneEmpty(v)
      if (pruned !== undefined && !isEmpty(pruned)) out[k] = pruned
    }
    return (isEmpty(out) ? undefined : out) as T | undefined
  }
  if (typeof value === "string") {
    const t = value.trim()
    return (t === "" ? undefined : t) as T | undefined
  }
  return value
}

function toNumber(value: SchemaFormValue): number | string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value === "number") return value
  const cleaned = String(value).replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".")
  const n = Number(cleaned)
  return Number.isFinite(n) && cleaned !== "" ? n : String(value)
}

function convert(field: FieldDef, value: SchemaFormValue): JsonLdValue | undefined {
  if (value === undefined || value === null) return undefined
  switch (field.type) {
    case "number":
      return toNumber(value)
    case "select": {
      const v = String(value).trim()
      if (!v) return undefined
      return field.enumUrl ? `https://schema.org/${v}` : v
    }
    case "multiselect":
      return Array.isArray(value) ? (value as string[]) : String(value).split(",").map((s) => s.trim()).filter(Boolean)
    case "urlList":
      return (Array.isArray(value) ? (value as string[]) : String(value).split(/[\n,]+/)).map((s) => String(s).trim()).filter(Boolean)
    case "list":
      return Array.isArray(value)
        ? (value as SchemaFormData[]).map((item) => buildObject(field.fields ?? [], item, field.itemType))
        : undefined
    case "time": {
      const v = String(value).trim()
      return /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, "0") : v
    }
    default:
      return typeof value === "string" ? value : String(value)
  }
}

/** Set a dotted path, creating typed nested objects ("offers.price" → offers: {@type: Offer, price}). */
function setPath(target: JsonLdObject, path: string, value: JsonLdValue): void {
  const parts = path.split(".")
  let node = target
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!
    let next = node[key]
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      next = NESTED_TYPES[key] ? { "@type": NESTED_TYPES[key]! } : {}
      node[key] = next
    }
    node = next as JsonLdObject
  }
  node[parts[parts.length - 1]!] = value
}

function buildObject(fields: FieldDef[], data: SchemaFormData, type?: string): JsonLdObject {
  const obj: JsonLdObject = type ? { "@type": type } : {}
  for (const field of fields) {
    const converted = convert(field, data[field.key])
    if (converted === undefined) continue
    setPath(obj, field.key, converted)
  }
  return obj
}

/** Build a schema.org JSON-LD object from visual-builder form data. */
export function buildJsonLd(type: SchemaType, data: SchemaFormData): JsonLdObject {
  const def = SCHEMA_DEFINITIONS[type]
  const obj = buildObject(def.fields, data, type)
  if (type === "Article" && typeof obj.mainEntityOfPage === "string") {
    obj.mainEntityOfPage = { "@type": "WebPage", "@id": obj.mainEntityOfPage }
  }
  return { "@context": "https://schema.org", ...(pruneEmpty(obj) ?? { "@type": type }) }
}

/** Merge several JSON-LD objects into one @graph document (one <script> per location on Framer). */
export function combineGraph(objects: JsonLdObject[]): JsonLdObject {
  if (objects.length === 1) return objects[0]!
  return {
    "@context": "https://schema.org",
    "@graph": objects.map(({ "@context": _ctx, ...rest }) => rest as JsonLdObject),
  }
}

/** Reverse of buildJsonLd for round-tripping existing markup into the form (best effort). */
export function jsonLdToFormData(type: SchemaType, jsonld: JsonLdObject): SchemaFormData {
  const def = SCHEMA_DEFINITIONS[type]
  const get = (obj: JsonLdObject, path: string): JsonLdValue | undefined =>
    path.split(".").reduce<JsonLdValue | undefined>(
      (acc, key) => (acc && typeof acc === "object" && !Array.isArray(acc) ? (acc as JsonLdObject)[key] : undefined),
      obj,
    )
  const read = (fields: FieldDef[], obj: JsonLdObject): SchemaFormData => {
    const data: SchemaFormData = {}
    for (const f of fields) {
      let v = get(obj, f.key)
      if (v === undefined) continue
      if (f.key === "mainEntityOfPage" && v && typeof v === "object" && !Array.isArray(v)) v = (v as JsonLdObject)["@id"]
      if (f.type === "list") {
        const items = Array.isArray(v) ? v : [v]
        data[f.key] = items.filter((i): i is JsonLdObject => !!i && typeof i === "object" && !Array.isArray(i)).map((i) => read(f.fields ?? [], i))
      } else if (f.type === "select" && f.enumUrl && typeof v === "string") {
        data[f.key] = v.replace(/^https?:\/\/schema\.org\//, "")
      } else if ((f.type === "multiselect" || f.type === "urlList") && Array.isArray(v)) {
        data[f.key] = v.map(String)
      } else if (typeof v === "string" || typeof v === "number") {
        data[f.key] = v
      }
    }
    return data
  }
  return read(def.fields, jsonld)
}
