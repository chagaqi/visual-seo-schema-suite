import type { JsonLdObject, JsonLdValue } from "./build.ts"

export interface SchemaIssue {
  /** JSON-LD path, e.g. "offers.price" or "mainEntity[1].acceptedAnswer.text". */
  path: string
  message: string
  severity: "error" | "warning"
}

export interface SchemaValidationResult {
  valid: boolean
  /** No errors and every required rich-result property present. */
  richResultEligible: boolean
  errors: SchemaIssue[]
  warnings: SchemaIssue[]
  types: string[]
}

type Check = "url" | "date" | "currency" | "number" | "time" | "tel" | "nonEmpty"

interface Rule {
  path: string
  level: "required" | "recommended"
  checks?: Check[]
  maxLength?: number
  message?: string
}

interface TypeRules {
  rules: Rule[]
  /** At least one of these paths must be present. */
  anyOf?: { paths: string[]; level: "required" | "recommended"; message: string }[]
}

const LOCAL_BUSINESS_SUBTYPES = [
  "LocalBusiness", "Restaurant", "CafeOrCoffeeShop", "Bakery", "BarOrPub", "Store", "ClothingStore",
  "ProfessionalService", "LegalService", "AccountingService", "FinancialService", "RealEstateAgent", "MedicalBusiness",
  "Dentist", "Physician", "BeautySalon", "HairSalon", "DaySpa", "HealthClub", "AutoRepair",
  "HomeAndConstructionBusiness", "Plumber", "Electrician", "Hotel", "TravelAgency", "FoodEstablishment",
]
const ARTICLE_SUBTYPES = ["Article", "BlogPosting", "NewsArticle", "TechArticle", "Report", "ScholarlyArticle"]
const SOFTWARE_SUBTYPES = ["SoftwareApplication", "WebApplication", "MobileApplication", "VideoGame"]

const RULES: Record<string, TypeRules> = {
  LocalBusiness: {
    rules: [
      { path: "name", level: "required" },
      { path: "address", level: "required", message: "A PostalAddress is required." },
      { path: "address.streetAddress", level: "recommended" },
      { path: "address.addressLocality", level: "recommended" },
      { path: "address.postalCode", level: "recommended" },
      { path: "address.addressCountry", level: "recommended" },
      { path: "telephone", level: "recommended", checks: ["tel"] },
      { path: "url", level: "recommended", checks: ["url"] },
      { path: "image", level: "recommended", checks: ["url"] },
      { path: "priceRange", level: "recommended", maxLength: 100 },
      { path: "geo.latitude", level: "recommended", checks: ["number"] },
      { path: "geo.longitude", level: "recommended", checks: ["number"] },
      { path: "openingHoursSpecification", level: "recommended" },
      { path: "openingHoursSpecification[].dayOfWeek", level: "required", checks: ["nonEmpty"] },
      { path: "openingHoursSpecification[].opens", level: "required", checks: ["time"] },
      { path: "openingHoursSpecification[].closes", level: "required", checks: ["time"] },
    ],
  },
  Product: {
    rules: [
      { path: "name", level: "required" },
      { path: "image", level: "recommended", checks: ["url"] },
      { path: "description", level: "recommended" },
      { path: "brand.name", level: "recommended" },
      { path: "offers.price", level: "required", checks: ["number"] },
      { path: "offers.priceCurrency", level: "required", checks: ["currency"] },
      { path: "offers.availability", level: "recommended", checks: ["url"] },
      { path: "offers.priceValidUntil", level: "recommended", checks: ["date"] },
      { path: "review[].author.name", level: "required" },
      { path: "review[].reviewRating.ratingValue", level: "required", checks: ["number"] },
    ],
    anyOf: [
      {
        paths: ["offers", "aggregateRating", "review"],
        level: "required",
        message: "Product snippets need at least one of offers, aggregateRating or review.",
      },
    ],
  },
  FAQPage: {
    rules: [
      { path: "mainEntity", level: "required", checks: ["nonEmpty"], message: "Add at least one question." },
      { path: "mainEntity[].name", level: "required" },
      { path: "mainEntity[].acceptedAnswer.text", level: "required" },
    ],
  },
  Article: {
    rules: [
      { path: "headline", level: "recommended", maxLength: 110 },
      { path: "image", level: "recommended", checks: ["url"] },
      { path: "datePublished", level: "recommended", checks: ["date"] },
      { path: "dateModified", level: "recommended", checks: ["date"] },
      { path: "author", level: "recommended" },
      { path: "author[].name", level: "required" },
      { path: "author[].url", level: "recommended", checks: ["url"] },
    ],
  },
  SoftwareApplication: {
    rules: [
      { path: "name", level: "required" },
      { path: "offers.price", level: "required", checks: ["number"] },
      { path: "offers.priceCurrency", level: "recommended", checks: ["currency"] },
      { path: "operatingSystem", level: "recommended" },
      { path: "applicationCategory", level: "recommended" },
    ],
    anyOf: [
      {
        paths: ["aggregateRating", "review"],
        level: "required",
        message: "Software app rich results need aggregateRating or review.",
      },
    ],
  },
  Question: { rules: [{ path: "name", level: "required" }, { path: "acceptedAnswer.text", level: "required" }] },
  Organization: { rules: [{ path: "name", level: "required" }, { path: "url", level: "recommended", checks: ["url"] }, { path: "logo", level: "recommended" }] },
  WebSite: { rules: [{ path: "name", level: "recommended" }, { path: "url", level: "required", checks: ["url"] }] },
  BreadcrumbList: {
    rules: [
      { path: "itemListElement", level: "required", checks: ["nonEmpty"] },
      { path: "itemListElement[].position", level: "required", checks: ["number"] },
      { path: "itemListElement[].name", level: "required" },
    ],
  },
}

function rulesFor(type: string): TypeRules | undefined {
  if (LOCAL_BUSINESS_SUBTYPES.includes(type)) return RULES.LocalBusiness
  if (ARTICLE_SUBTYPES.includes(type)) return RULES.Article
  if (SOFTWARE_SUBTYPES.includes(type)) return RULES.SoftwareApplication
  return RULES[type]
}

interface Match {
  path: string
  value: JsonLdValue | undefined
}

/** Resolve a rule path with `[]` wildcards against an object. Missing leaves are returned as undefined. */
export function resolvePath(obj: JsonLdValue | undefined, path: string, prefix = ""): Match[] {
  const [head, ...rest] = path.split(".")
  if (!head) return [{ path: prefix, value: obj }]
  const isArray = head.endsWith("[]")
  const key = isArray ? head.slice(0, -2) : head
  const joined = prefix ? `${prefix}.${key}` : key
  const child = obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as JsonLdObject)[key] : undefined
  if (isArray) {
    if (child === undefined) return [] // wildcard over nothing: the parent rule reports absence
    const items = Array.isArray(child) ? child : [child]
    return items.flatMap((item, i) => resolvePath(item, rest.join("."), `${joined}[${i}]`))
  }
  if (rest.length === 0) return [{ path: joined, value: child }]
  // Single object or the first element of an array (schema.org allows both).
  const next = Array.isArray(child) ? child[0] : child
  if (next === undefined) return [{ path: `${joined}.${rest.join(".").replace(/\[\]/g, "")}`, value: undefined }]
  return resolvePath(next, rest.join("."), joined)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const CURRENCY = /^[A-Z]{3}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const TEL = /^\+?[\d\s().-]{6,20}$/

function isPresent(value: JsonLdValue | undefined): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "string") return value.trim() !== ""
  if (Array.isArray(value)) return value.length > 0
  return true
}

function checkValue(check: Check, value: JsonLdValue, path: string): string | null {
  const values = Array.isArray(value) ? value : [value]
  for (const v of values) {
    switch (check) {
      case "url": {
        const s = typeof v === "object" && v && !Array.isArray(v) ? ((v as JsonLdObject).url ?? (v as JsonLdObject)["@id"]) : v
        if (typeof s !== "string") return `${path} must be a URL.`
        try {
          const u = new URL(s)
          if (!/^https?:$/.test(u.protocol)) return `${path} must be an http(s) URL.`
        } catch {
          return `${path} must be an absolute URL (got "${s}").`
        }
        break
      }
      case "date":
        if (typeof v !== "string" || !ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) return `${path} must be an ISO 8601 date (YYYY-MM-DD).`
        break
      case "currency":
        if (typeof v !== "string" || !CURRENCY.test(v)) return `${path} must be a 3-letter ISO 4217 currency code, e.g. "USD".`
        break
      case "number":
        if (typeof v === "number" ? !Number.isFinite(v) : typeof v !== "string" || !/^-?\d+(\.\d+)?$/.test(v.trim()))
          return `${path} must be a number without currency symbols.`
        break
      case "time":
        if (typeof v !== "string" || !TIME.test(v)) return `${path} must be a 24h time like "09:00".`
        break
      case "tel":
        if (typeof v !== "string" || !TEL.test(v)) return `${path} doesn't look like a phone number; include the country code (+1…).`
        break
      case "nonEmpty":
        if (!isPresent(v)) return `${path} must not be empty.`
        break
    }
  }
  return null
}

function typesOf(obj: JsonLdObject): string[] {
  const t = obj["@type"]
  if (typeof t === "string") return [t]
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string")
  return []
}

/** Generic, type-independent sanity checks that apply anywhere in the tree. */
function deepChecks(value: JsonLdValue, path: string, issues: SchemaIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepChecks(v, `${path}[${i}]`, issues))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, v] of Object.entries(value)) {
    const p = path ? `${path}.${key}` : key
    if (typeof v === "string") {
      if (/<script/i.test(v)) issues.push({ path: p, message: `${p} contains a <script> tag.`, severity: "error" })
      if (["datePublished", "dateModified", "priceValidUntil", "startDate", "endDate", "uploadDate"].includes(key)) {
        const err = checkValue("date", v, p)
        if (err) issues.push({ path: p, message: err, severity: "error" })
      }
      if (["url", "sameAs", "logo", "menu", "image", "contentUrl", "thumbnailUrl"].includes(key)) {
        const err = checkValue("url", v, p)
        if (err) issues.push({ path: p, message: err, severity: "error" })
      }
    }
    if (key === "aggregateRating" || key === "reviewRating") {
      const r = v as JsonLdObject
      const val = Number(r?.ratingValue)
      const best = r?.bestRating !== undefined ? Number(r.bestRating) : 5
      const worst = r?.worstRating !== undefined ? Number(r.worstRating) : 1
      if (r?.ratingValue !== undefined && (Number.isNaN(val) || val < worst || val > best))
        issues.push({ path: `${p}.ratingValue`, message: `${p}.ratingValue must be between ${worst} and ${best}.`, severity: "error" })
      if (key === "aggregateRating" && r && r.reviewCount === undefined && r.ratingCount === undefined)
        issues.push({ path: `${p}.reviewCount`, message: `${p} needs reviewCount or ratingCount.`, severity: "error" })
    }
    if (key === "geo" && v && typeof v === "object") {
      const g = v as JsonLdObject
      const lat = Number(g.latitude)
      const lng = Number(g.longitude)
      if (g.latitude !== undefined && (Number.isNaN(lat) || lat < -90 || lat > 90))
        issues.push({ path: `${p}.latitude`, message: "Latitude must be between -90 and 90.", severity: "error" })
      if (g.longitude !== undefined && (Number.isNaN(lng) || lng < -180 || lng > 180))
        issues.push({ path: `${p}.longitude`, message: "Longitude must be between -180 and 180.", severity: "error" })
    }
    if (key === "gtin" && typeof v === "string" && !/^(\d{8}|\d{12,14})$/.test(v.replace(/\s|-/g, "")))
      issues.push({ path: p, message: "GTIN must be 8, 12, 13 or 14 digits.", severity: "error" })
    if (typeof v === "object") deepChecks(v, p, issues)
  }
}

function validateNode(node: JsonLdObject, prefix: string, issues: SchemaIssue[], topLevel: boolean): void {
  const at = (p: string) => (prefix ? `${prefix}.${p}` : p)
  if (topLevel) {
    const ctx = node["@context"]
    const ctxString = typeof ctx === "string" ? ctx : Array.isArray(ctx) ? ctx.find((c) => typeof c === "string") : undefined
    if (!ctx) issues.push({ path: at("@context"), message: 'Missing "@context": "https://schema.org".', severity: "error" })
    else if (typeof ctxString !== "string" || !/^https?:\/\/schema\.org\/?$/.test(ctxString))
      issues.push({ path: at("@context"), message: '@context should be "https://schema.org".', severity: "warning" })
  }
  const types = typesOf(node)
  if (types.length === 0) {
    issues.push({ path: at("@type"), message: 'Missing "@type".', severity: "error" })
    return
  }
  for (const type of types) {
    const rules = rulesFor(type)
    if (!rules) continue
    for (const rule of rules.rules) {
      const matches = resolvePath(node, rule.path)
      for (const m of matches) {
        const path = prefix ? `${prefix}.${m.path}` : m.path
        if (!isPresent(m.value)) {
          issues.push({
            path,
            message: rule.message ?? `${rule.level === "required" ? "Missing required" : "Missing recommended"} property "${m.path}".`,
            severity: rule.level === "required" ? "error" : "warning",
          })
          continue
        }
        for (const check of rule.checks ?? []) {
          const err = checkValue(check, m.value!, path)
          if (err) issues.push({ path, message: err, severity: "error" })
        }
        if (rule.maxLength && typeof m.value === "string" && m.value.length > rule.maxLength)
          issues.push({ path, message: `${path} is ${m.value.length} characters; max ${rule.maxLength}.`, severity: "warning" })
      }
    }
    for (const group of rules.anyOf ?? []) {
      if (!group.paths.some((p) => isPresent(node[p])))
        issues.push({ path: prefix || group.paths[0]!, message: group.message, severity: group.level === "required" ? "error" : "warning" })
    }
  }
}

/** Validate one JSON-LD document (object, @graph document or array of documents). */
export function validateJsonLd(input: JsonLdValue | string): SchemaValidationResult {
  const issues: SchemaIssue[] = []
  let doc: JsonLdValue
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input) as JsonLdValue
    } catch (e) {
      return {
        valid: false,
        richResultEligible: false,
        errors: [{ path: "", message: `Invalid JSON: ${(e as Error).message}`, severity: "error" }],
        warnings: [],
        types: [],
      }
    }
  } else {
    doc = input
  }

  const roots = Array.isArray(doc) ? doc : [doc]
  const types: string[] = []
  roots.forEach((root, ri) => {
    const rootPrefix = roots.length > 1 ? `[${ri}]` : ""
    if (!root || typeof root !== "object" || Array.isArray(root)) {
      issues.push({ path: rootPrefix, message: "JSON-LD must be an object.", severity: "error" })
      return
    }
    const graph = (root as JsonLdObject)["@graph"]
    if (Array.isArray(graph)) {
      validateNode({ "@type": "Graph", ...(root as JsonLdObject) }, rootPrefix, issues, true)
      graph.forEach((g, gi) => {
        if (g && typeof g === "object" && !Array.isArray(g)) {
          types.push(...typesOf(g as JsonLdObject))
          validateNode(g as JsonLdObject, `${rootPrefix}@graph[${gi}]`, issues, false)
        }
      })
    } else {
      types.push(...typesOf(root as JsonLdObject))
      validateNode(root as JsonLdObject, rootPrefix, issues, true)
    }
    deepChecks(root, rootPrefix, issues)
  })

  // De-duplicate identical messages on the same path (deep + rule checks may overlap).
  const seen = new Set<string>()
  const unique = issues.filter((i) => {
    const key = `${i.path}|${i.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const errors = unique.filter((i) => i.severity === "error")
  const warnings = unique.filter((i) => i.severity === "warning")
  const valid = errors.length === 0
  return { valid, richResultEligible: valid && types.some((t) => rulesFor(t) !== undefined), errors, warnings, types }
}
