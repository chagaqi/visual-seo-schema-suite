import { capitalizeFirst, contentWords, sentences, squish, truncateAtWord } from "../text/util.ts"
import { isDefaultLayerName, parseImageFilename, type ImageKind, type ParsedFilename } from "./filename.ts"

/** Everything the host knows about an image. All fields are optional; more context → better alt text. */
export interface AltTextContext {
  /** Image URL (used for filename parsing). */
  src?: string
  /** Original filename if the host exposes it separately (Webflow asset name). */
  filename?: string
  existingAlt?: string | null
  /** Layer / element / display name from the design tool. */
  layerName?: string | null
  /** Caption, heading or adjacent text block. */
  nearbyText?: string | null
  /** CMS item title when the image belongs to a collection item. */
  collectionItemTitle?: string | null
  pageTitle?: string | null
  siteName?: string | null
  /** Brand name, used for logos. */
  brand?: string | null
  /** Target keywords; only used to strengthen weak descriptions, never stuffed. */
  keywords?: string[]
  width?: number | null
  height?: number | null
  /** Image is wrapped in a link: alt text must describe the destination/function. */
  linkHref?: string | null
}

export type AltTextSource =
  | "existing"
  | "collection"
  | "layer"
  | "filename"
  | "nearby"
  | "page"
  | "keyword"
  | "ai"
  | "fallback"
  | "decorative"

export interface AltTextResult {
  alt: string
  decorative: boolean
  kind: ImageKind
  /** 0–1 heuristic confidence. */
  confidence: number
  source: AltTextSource
  needsReview: boolean
  reasons: string[]
}

export interface AltTextOptions {
  /** Max length; screen-reader guidance suggests ~125 characters. */
  maxLength?: number
  /** Replace existing alt text even if it already passes the linter. */
  overwrite?: boolean
  /** Below this confidence the result is flagged for review. */
  reviewThreshold?: number
}

const DEFAULTS: Required<AltTextOptions> = { maxLength: 125, overwrite: false, reviewThreshold: 0.6 }

export type AltLintSeverity = "error" | "warning"

export interface AltLintIssue {
  code:
    | "missing"
    | "too-long"
    | "redundant-prefix"
    | "filename"
    | "placeholder"
    | "all-caps"
    | "click-here"
    | "duplicate-of-caption"
    | "too-short"
  severity: AltLintSeverity
  message: string
}

const REDUNDANT_PREFIX = /^(an?\s+)?(image|picture|photo|photograph|graphic|pic|img|icon|logo)\s+(of|showing|shows|depicting|with)\s+/i
const PLACEHOLDER = /^(alt|image|img|photo|picture|pic|graphic|logo|icon|banner|hero|thumbnail|avatar|screenshot|untitled|placeholder|todo|tbd|test|asdf|null|undefined|none|\.|-|_)$/i

/** WCAG 1.1.1 oriented lint for a single alt text. */
export function lintAltText(
  alt: string | null | undefined,
  ctx: Pick<AltTextContext, "nearbyText"> & { decorative?: boolean } = {},
  maxLength = DEFAULTS.maxLength,
): AltLintIssue[] {
  const issues: AltLintIssue[] = []
  const text = squish(alt ?? "")
  if (!text) {
    if (!ctx.decorative)
      issues.push({ code: "missing", severity: "error", message: "Image has no alt text (WCAG 1.1.1)." })
    return issues
  }
  if (PLACEHOLDER.test(text))
    issues.push({ code: "placeholder", severity: "error", message: `"${text}" is a placeholder, not a description.` })
  const parsed = parseImageFilename(text)
  if (parsed.extension || parsed.machineGenerated || /^[\w-]+_[\w-]+$/.test(text))
    issues.push({ code: "filename", severity: "error", message: "Alt text looks like a filename." })
  if (text.length > maxLength)
    issues.push({
      code: "too-long",
      severity: "warning",
      message: `Alt text is ${text.length} characters; keep it under ${maxLength}.`,
    })
  if (REDUNDANT_PREFIX.test(text))
    issues.push({
      code: "redundant-prefix",
      severity: "warning",
      message: 'Screen readers already announce "image" — drop prefixes like "Image of".',
    })
  if (text.length > 12 && text === text.toUpperCase() && /[A-Z]/.test(text))
    issues.push({ code: "all-caps", severity: "warning", message: "All-caps text is read letter by letter by some screen readers." })
  if (/\b(click|tap) here\b/i.test(text))
    issues.push({ code: "click-here", severity: "warning", message: 'Avoid "click here"; describe the destination.' })
  if (ctx.nearbyText && squish(ctx.nearbyText).toLowerCase() === text.toLowerCase())
    issues.push({
      code: "duplicate-of-caption",
      severity: "warning",
      message: "Alt text duplicates the adjacent caption; screen readers will hear it twice.",
    })
  if (text.length < 4 && !PLACEHOLDER.test(text))
    issues.push({ code: "too-short", severity: "warning", message: "Alt text is very short; is it descriptive?" })
  return issues
}

interface Candidate {
  subject: string
  score: number
  source: AltTextSource
  reason: string
}

function cleanSubject(input: string): string {
  return squish(input.replace(REDUNDANT_PREFIX, "").replace(/[_]+/g, " ").replace(/\s+[-–—|:]\s*$/, ""))
}

function layerCandidate(name: string | null | undefined): Candidate | null {
  if (!name || isDefaultLayerName(name)) return null
  const parsed = parseImageFilename(name)
  // Names made only of kind/noise words ("Divider", "Logo", "Hero bg") describe nothing.
  if (!parsed.extension && parseImageFilename(name.trim().replace(/\s+/g, "-")).tokens.length === 0) return null
  // A layer named like a file ("hero.png") → parse it; otherwise keep human wording/casing.
  const subject = parsed.extension ? parsed.phrase : cleanSubject(name.replace(/\s*\d+$/, ""))
  if (!subject || contentWords(subject).length === 0) return null
  const n = contentWords(subject).length
  return { subject, score: Math.min(0.8, 0.55 + n * 0.08), source: "layer", reason: `Layer name "${name}"` }
}

function filenameCandidate(parsed: ParsedFilename): Candidate | null {
  if (!parsed.informative) return null
  const n = parsed.tokens.length
  return {
    subject: parsed.phrase,
    score: Math.min(0.78, 0.42 + n * 0.09),
    source: "filename",
    reason: `Filename "${parsed.basename}"`,
  }
}

function nearbyCandidate(text: string | null | undefined): Candidate | null {
  if (!text) return null
  const first = sentences(text)[0]
  if (!first) return null
  const subject = cleanSubject(first.replace(/[.!?]+$/, ""))
  const n = contentWords(subject).length
  if (n === 0) return null
  return { subject, score: n >= 3 ? 0.62 : 0.5, source: "nearby", reason: "Adjacent caption/heading" }
}

function linkDestination(href: string): string | null {
  try {
    const url = new URL(href, "https://example.invalid")
    const pathWords = url.pathname
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[-_]+/g, " ")
      .replace(/\.\w+$/, "")
    if (pathWords && contentWords(pathWords).length > 0) return pathWords
    if (url.hostname !== "example.invalid") return url.hostname.replace(/^www\./, "")
  } catch {
    /* ignore malformed */
  }
  return null
}

function pickKind(parsed: ParsedFilename, ctx: AltTextContext): ImageKind {
  const layerKinds = ctx.layerName ? parseImageFilename(ctx.layerName.replace(/\s+/g, "-")).kinds : []
  const all = [...layerKinds, ...parsed.kinds]
  const priority: ImageKind[] = ["qr", "logo", "icon", "screenshot", "chart", "map", "person", "product", "decorative", "hero", "illustration"]
  for (const k of priority) if (all.includes(k)) return k
  return "photo"
}

function isDecorative(kind: ImageKind, ctx: AltTextContext, best: Candidate | undefined): string | null {
  const w = ctx.width ?? null
  const h = ctx.height ?? null
  if (w !== null && h !== null && (w <= 2 || h <= 2)) return "Image is 2px or smaller (spacer)."
  if (kind === "decorative" && (!best || best.score < 0.6)) return "Name indicates a decorative background/pattern."
  return null
}

function titleCase(phrase: string): string {
  return phrase.replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

function compose(kind: ImageKind, subject: string, ctx: AltTextContext): string {
  const brand = ctx.brand ?? ctx.siteName ?? null
  switch (kind) {
    case "logo": {
      const who = subject || brand || ""
      return who ? `${titleCaseIfLower(who)} logo` : "Logo"
    }
    case "icon":
      return subject ? `${subject} icon` : "Icon"
    case "person": {
      const tokens = subject.split(/\s+/).filter(Boolean)
      const looksLikeName = tokens.length >= 1 && tokens.length <= 3 && tokens.every((t) => /^[\p{L}'’-]+$/u.test(t))
      if (looksLikeName) return `Portrait of ${titleCaseIfLower(subject)}`
      return subject ? `Portrait: ${subject}` : "Portrait"
    }
    case "screenshot":
      return subject ? `Screenshot of ${subject}` : "Screenshot"
    case "chart":
      return subject ? `Chart showing ${subject}` : "Chart"
    case "map":
      return /\bmap\b/i.test(subject) ? subject : subject ? `Map of ${subject}` : "Map"
    case "qr": {
      const dest = ctx.linkHref ? linkDestination(ctx.linkHref) : null
      return dest ? `QR code linking to ${dest}` : subject ? `QR code for ${subject}` : "QR code"
    }
    default:
      return subject
  }
}

function titleCaseIfLower(s: string): string {
  return s === s.toLowerCase() ? titleCase(s) : s
}

/**
 * Deterministic, zero-API alt text generator.
 *
 * Ranks the available signals (CMS title, layer name, filename, caption, page title), picks the
 * strongest, shapes it by image kind (logo / icon / portrait / screenshot / chart …) and enforces
 * WCAG-friendly formatting (no "image of", ≤125 chars, sentence case).
 */
export function generateAltText(ctx: AltTextContext, options: AltTextOptions = {}): AltTextResult {
  const opts = { ...DEFAULTS, ...options }
  const reasons: string[] = []
  const parsed = parseImageFilename(ctx.filename || ctx.src || "")
  const kind = pickKind(parsed, ctx)

  if (ctx.existingAlt && !opts.overwrite) {
    const issues = lintAltText(ctx.existingAlt, { nearbyText: ctx.nearbyText }, opts.maxLength)
    if (!issues.some((i) => i.severity === "error")) {
      return {
        alt: squish(ctx.existingAlt),
        decorative: false,
        kind,
        confidence: issues.length === 0 ? 0.95 : 0.75,
        source: "existing",
        needsReview: issues.length > 0,
        reasons: ["Existing alt text kept", ...issues.map((i) => i.message)],
      }
    }
    reasons.push("Existing alt text failed lint and was replaced")
  }

  const candidates: Candidate[] = []
  if (ctx.collectionItemTitle && contentWords(ctx.collectionItemTitle).length > 0) {
    candidates.push({
      subject: cleanSubject(ctx.collectionItemTitle),
      score: 0.82,
      source: "collection",
      reason: "CMS item title",
    })
  }
  const layer = layerCandidate(ctx.layerName)
  if (layer) candidates.push(layer)
  const file = filenameCandidate(parsed)
  if (file) candidates.push(file)
  const nearby = nearbyCandidate(ctx.nearbyText)
  if (nearby) candidates.push(nearby)

  // Agreement bonus: when two independent sources share content words, trust them more.
  for (const c of candidates) {
    const cw = new Set(contentWords(c.subject))
    const agreeing = candidates.filter(
      (o) => o !== c && contentWords(o.subject).some((w) => cw.has(w)),
    ).length
    if (agreeing > 0) c.score = Math.min(0.92, c.score + 0.08 * agreeing)
  }
  candidates.sort((a, b) => b.score - a.score)
  let best = candidates[0]

  const decorativeReason = isDecorative(kind, ctx, best)
  if (decorativeReason) {
    return {
      alt: "",
      decorative: true,
      kind: "decorative",
      confidence: 0.8,
      source: "decorative",
      needsReview: false,
      reasons: [...reasons, decorativeReason, 'Use alt="" so screen readers skip it.'],
    }
  }

  // Logos with no subject fall back to the brand name.
  if (!best && kind === "logo" && (ctx.brand || ctx.siteName)) {
    best = { subject: (ctx.brand || ctx.siteName)!, score: 0.7, source: "page", reason: "Brand/site name" }
  }

  // Linked images describe their destination.
  if (ctx.linkHref && (!best || best.score < 0.6) && kind !== "qr") {
    const dest = linkDestination(ctx.linkHref)
    if (dest) best = { subject: dest, score: 0.55, source: "page", reason: `Link destination ${ctx.linkHref}` }
  }

  if (!best && ctx.keywords && ctx.keywords.length > 0) {
    best = { subject: ctx.keywords[0]!, score: 0.35, source: "keyword", reason: "Primary keyword" }
  }
  if (!best && ctx.pageTitle) {
    const title = ctx.pageTitle.split(/\s[|–—-]\s/)[0] ?? ctx.pageTitle
    best = { subject: title, score: 0.3, source: "page", reason: "Page title (weak signal)" }
  }

  if (!best) {
    const fallback = kind === "photo" ? "" : compose(kind, "", ctx)
    return {
      alt: fallback,
      decorative: false,
      kind,
      confidence: 0.1,
      source: "fallback",
      needsReview: true,
      reasons: [...reasons, "No descriptive signal found — please describe this image manually."],
    }
  }

  // Weak descriptions get one keyword as qualifier when it is not already present (no stuffing).
  let subject = best.subject
  if (best.score < 0.5 && ctx.keywords?.length) {
    const kw = ctx.keywords.find((k) => !subject.toLowerCase().includes(k.toLowerCase()))
    if (kw && best.source !== "keyword") subject = `${subject} – ${kw}`
  }

  let alt = compose(kind, subject, ctx)
  alt = capitalizeFirst(squish(alt.replace(REDUNDANT_PREFIX, "")))
  alt = alt.replace(/[.]+$/, "")
  alt = truncateAtWord(alt, opts.maxLength)

  reasons.push(best.reason)
  if (kind !== "photo") reasons.push(`Detected kind: ${kind}`)
  const confidence = Math.round(best.score * 100) / 100

  return {
    alt,
    decorative: false,
    kind,
    confidence,
    source: best.source,
    needsReview: confidence < opts.reviewThreshold,
    reasons,
  }
}
