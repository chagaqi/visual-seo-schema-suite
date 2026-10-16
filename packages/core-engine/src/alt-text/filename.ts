/**
 * Smart filename / URL parser.
 *
 * Turns things like
 *   https://cdn.prod.website-files.com/64f…a1/6512…9c_team-photo_SanFrancisco-office@2x-p-1080.jpeg
 *   IMG_20230412_101500.jpg
 *   hero-bg-v3-final-FINAL.png
 * into meaningful, human-readable tokens plus "kind" hints (logo, icon, person, screenshot…).
 */

export type ImageKind =
  | "photo"
  | "logo"
  | "icon"
  | "person"
  | "screenshot"
  | "chart"
  | "hero"
  | "product"
  | "map"
  | "qr"
  | "illustration"
  | "decorative"

export interface ParsedFilename {
  /** Basename without extension, as decoded from the URL. */
  basename: string
  extension: string | null
  /** Meaningful, lower-cased tokens in original order (noise, hashes and sizes removed). */
  tokens: string[]
  /** Tokens that only signal the kind (e.g. "logo", "icon") and were removed from `tokens`. */
  kindTokens: string[]
  kinds: ImageKind[]
  /** Human readable phrase built from `tokens`. */
  phrase: string
  /** True when the filename carries any descriptive information at all. */
  informative: boolean
  /** True when the name came from a camera, screenshot tool or stock site pattern. */
  machineGenerated: boolean
}

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "avif", "gif", "svg", "tif", "tiff", "heic", "heif", "bmp", "ico", "jfif",
])

/** Words that carry no description and are dropped entirely. */
const NOISE = new Set([
  "img", "image", "images", "photo", "photos", "pic", "pics", "picture", "untitled", "unnamed", "copy", "final",
  "edit", "edited", "new", "old", "draft", "export", "exported", "compressed", "optimized", "optimised", "min",
  "web", "large", "small", "medium", "lg", "sm", "md", "xl", "xs", "hd", "hq", "lowres", "hires", "retina", "crop",
  "cropped", "resized", "scaled", "asset", "assets", "file", "default", "sample", "placeholder", "temp", "tmp",
  "upload", "uploads", "original", "orig", "full", "fullsize", "thumb", "thumbnail", "preview", "version", "rev",
  "dsc", "dscn", "dcim", "pxl", "mvimg", "wa", "jpeg", "jpg", "png", "webp", "avif", "svg", "gif", "framerusercontent",
  "unsplash", "pexels", "pixabay", "shutterstock", "istock", "getty", "adobestock", "stock", "freepik", "canva",
  "mobile", "desktop", "tablet", "dark", "light", "alt", "img_", "frame", "group", "layer", "rectangle",
])

/** Words that only indicate the kind of image. */
const KIND_WORDS: Record<string, ImageKind> = {
  logo: "logo", logos: "logo", logotype: "logo", logomark: "logo", wordmark: "logo", brandmark: "logo",
  icon: "icon", icons: "icon", ico: "icon", favicon: "icon", glyph: "icon", pictogram: "icon",
  avatar: "person", headshot: "person", portrait: "person", profile: "person", selfie: "person",
  screenshot: "screenshot", screenshots: "screenshot", screencap: "screenshot", ss: "screenshot", mockup: "screenshot",
  chart: "chart", graph: "chart", diagram: "chart", infographic: "chart", graphic: "illustration",
  hero: "hero", banner: "hero", cover: "hero", masthead: "hero", header: "hero", og: "hero",
  map: "map", qr: "qr", qrcode: "qr",
  illustration: "illustration", illo: "illustration", drawing: "illustration", vector: "illustration",
  pattern: "decorative", texture: "decorative", divider: "decorative", spacer: "decorative", separator: "decorative",
  gradient: "decorative", blob: "decorative", shape: "decorative", decor: "decorative", decoration: "decorative",
  ornament: "decorative", overlay: "decorative", noise: "decorative", grain: "decorative", bg: "decorative",
  background: "decorative", backdrop: "decorative", squiggle: "decorative", swirl: "decorative", dots: "decorative",
}

/** Some kind words are also meaningful content ("team portrait", "product screenshot"): keep them visible. */
const KIND_WORDS_KEPT_AS_CONTENT = new Set(["map", "diagram", "infographic", "illustration", "drawing", "pattern"])

const ABBREVIATIONS: Record<string, string> = {
  btn: "button", nav: "navigation", hdr: "header", ftr: "footer", prod: "product", pdp: "product",
  nyc: "New York City", usa: "USA", uk: "UK", eu: "EU",
  ui: "UI", ux: "UX", cta: "call to action", faq: "FAQ", seo: "SEO", ceo: "CEO", cto: "CTO", hq: "headquarters",
  bday: "birthday", xmas: "Christmas", feat: "featured", lp: "landing page", app: "app", api: "API",
  ai: "AI", saas: "SaaS", ios: "iOS", mac: "Mac", tv: "TV", diy: "DIY", bw: "black and white", b2b: "B2B",
}

const PRODUCT_WORDS = new Set(["product", "sku", "item", "packshot", "pdp"])

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

/** Shannon entropy per character; random IDs score high. */
function entropy(token: string): number {
  const freq = new Map<string, number>()
  for (const ch of token) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let h = 0
  for (const count of freq.values()) {
    const p = count / token.length
    h -= p * Math.log2(p)
  }
  return h
}

/** Heuristic: does this token look like a hash / CDN id / random string rather than a word? */
export function looksRandom(token: string): boolean {
  if (token.length < 5) return false
  if (/^[0-9a-f]{8,}$/i.test(token) && /\d/.test(token)) return true // hex hash
  const hasDigit = /\d/.test(token)
  const hasLower = /[a-z]/.test(token)
  const hasUpper = /[A-Z]/.test(token)
  const classes = Number(hasDigit) + Number(hasLower) + Number(hasUpper)
  // camelCase compounds of real-looking words ("pricingPageCTA") are not random.
  if (!hasDigit) {
    const parts = splitCase(token)
    const wordLike = parts.every(
      (p) => (/^[A-Z]?[a-z]{2,}$/.test(p) && /[aeiouy]/i.test(p)) || /^[A-Z]{2,5}$/.test(p),
    )
    if (wordLike) return false
  }
  if (token.length >= 10 && classes >= 2 && entropy(token) > 3.2) return true
  if (token.length >= 6 && hasDigit && hasLower && /\d[a-z]+\d|[a-z]\d+[a-z]/i.test(token) && entropy(token) > 2.5)
    return true
  // Long consonant runs are not pronounceable words.
  if (!hasDigit && token.length >= 8 && /[bcdfghjklmnpqrstvwxz]{5,}/i.test(token)) return true
  return false
}

const MACHINE_PATTERNS: RegExp[] = [
  /^(img|dsc|dscn|dscf|pxl|mvimg|gopr|dji|sam|p)[-_ ]?\d{3,}/i,
  /^img[-_]\d{8}[-_]wa\d+/i,
  /^(screen ?shot|screenshot|capture d[’']écran|bildschirmfoto|schermata)[\s_-]*(\d|at\b|$)/i,
  /^photo on \d/i,
  /^whatsapp image/i,
  /^pexels-photo-\d+/i,
  /^photo-\d{10,}/i, // unsplash raw ids
  /^\d{6,}$/,
]

function splitCase(input: string): string[] {
  return input
    // camelCase / PascalCase boundaries (keep acronyms together: "SEOAudit" → "SEO Audit")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    // letters ↔ digits ("hero2" → "hero 2"), but keep things like "3d" / "4k" / "b2b" intact
    .replace(/([a-zA-Z]{3,})(\d+)/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
}

/** Split on separators first so random ids are detected before camelCase splitting shreds them. */
function splitWords(input: string): string[] {
  return input
    .split(/[\s_\-.+,()[\]{}~=|]+/)
    .filter(Boolean)
    .flatMap((chunk) => (looksRandom(chunk) ? [] : splitCase(chunk)))
}

const SIZE_TOKEN = /^(\d+x\d+|\d+w|\d+h|\d+px|\d+k|@?\d(\.\d)?x|p\d{3,4}|v\d+|r\d+|\d+dpi|\d{1,2}of\d{1,2})$/i

export function parseImageFilename(srcOrName: string): ParsedFilename {
  let raw = srcOrName.trim()
  // Data URIs carry no name.
  if (raw.startsWith("data:")) raw = ""
  // Strip query & hash, keep last path segment.
  raw = raw.split(/[?#]/)[0] ?? ""
  raw = safeDecode(raw.split("/").pop() ?? raw)

  let extension: string | null = null
  const extMatch = raw.match(/\.([a-z0-9]{2,5})$/i)
  if (extMatch && IMAGE_EXTENSIONS.has(extMatch[1]!.toLowerCase())) {
    extension = extMatch[1]!.toLowerCase()
    raw = raw.slice(0, -extMatch[0].length)
  }
  const basename = raw

  // Webflow CDN prefix: 24-hex asset id + underscore.
  raw = raw.replace(/^[0-9a-f]{24}_/i, "")
  // Webflow responsive variant suffix: -p-500, -p-1080
  raw = raw.replace(/-p-\d{3,4}$/i, "")
  // Retina / size suffixes
  raw = raw.replace(/@\d(\.\d)?x$/i, "")
  // WordPress-style size suffix: -1024x768, -scaled
  raw = raw.replace(/-\d{2,5}x\d{2,5}$/i, "").replace(/-scaled$/i, "")
  // Unsplash: "{author}-{11 char id}-unsplash" → drop the whole credit
  raw = raw.replace(/^[a-z-]+-[A-Za-z0-9_-]{11}-unsplash$/i, "unsplash")
  // Pexels: "pexels-{author}-{id}"
  raw = raw.replace(/^pexels-[a-z-]+-\d+$/i, "pexels")

  const machineGenerated = MACHINE_PATTERNS.some((re) => re.test(raw)) || /^unsplash$|^pexels$/.test(raw)
  const isScreenshot = /^(screen ?shot|screenshot|capture d|bildschirmfoto|schermata)/i.test(raw)

  const tokens: string[] = []
  const kindTokens: string[] = []
  const kinds = new Set<ImageKind>()
  if (isScreenshot) kinds.add("screenshot")

  if (!machineGenerated) {
    for (const part of splitWords(raw)) {
      if (looksRandom(part)) continue
      const lower = part.toLowerCase()
      if (SIZE_TOKEN.test(lower)) continue
      if (/^\d+$/.test(lower)) continue
      if (NOISE.has(lower)) continue
      if (lower.length === 1) continue
      const kind = KIND_WORDS[lower]
      if (kind) {
        kinds.add(kind)
        if (!KIND_WORDS_KEPT_AS_CONTENT.has(lower)) {
          kindTokens.push(lower)
          continue
        }
      }
      if (PRODUCT_WORDS.has(lower)) kinds.add("product")
      const expanded = ABBREVIATIONS[lower]
      if (expanded) {
        tokens.push(expanded)
        continue
      }
      // Preserve acronyms ("SEO") and brand casing ("iPhone"), lower-case the rest.
      tokens.push(/^[A-Z0-9]{2,}$/.test(part) || /^[a-z]+[A-Z]/.test(part) ? part : lower)
    }
  }

  // Drop repeated words ("logo-logo", "final-FINAL" already removed) while keeping order.
  const seen = new Set<string>()
  const unique = tokens.filter((t) => {
    const key = t.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (extension === "svg" && kinds.size === 0) kinds.add("illustration")
  // A "background" that also has real content ("background-team-photo") is not purely decorative.
  if (kinds.has("decorative") && unique.length >= 2) kinds.delete("decorative")

  return {
    basename,
    extension,
    tokens: unique,
    kindTokens,
    kinds: [...kinds],
    phrase: unique.join(" "),
    informative: unique.length > 0,
    machineGenerated,
  }
}

/** Default layer / element names that tools auto-assign and that carry no meaning. */
const DEFAULT_LAYER_NAME =
  /^(image|img|frame|rectangle|rect|group|layer|div|div block|container|section|block|graphic|picture|photo|bitmap|vector|shape|ellipse|component|instance|stack|grid|link block|hero image|background|bg)(\s*\d+)?$/i

export function isDefaultLayerName(name: string | null | undefined): boolean {
  if (!name) return true
  const trimmed = name.trim()
  if (!trimmed) return true
  if (DEFAULT_LAYER_NAME.test(trimmed)) return true
  if (/^\d+$/.test(trimmed)) return true
  if (parseImageFilename(trimmed).extension) return false
  return false
}
