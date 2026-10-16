import { capitalizeFirst, contentWords, sentences, squish, truncateAtWord, words } from "../text/util.ts"

export type PageType = "page" | "home" | "article" | "product" | "collection" | "local"

export interface PageContent {
  title?: string | null
  headings?: string[]
  bodyText?: string | null
  keywords?: string[]
  brand?: string | null
  url?: string | null
  existingDescription?: string | null
  /** Custom call to action ("Book a free demo."). */
  cta?: string | null
  type?: PageType
}

export interface MetaIssue {
  code: "missing" | "too-short" | "too-long" | "too-wide" | "no-keyword" | "duplicate-title" | "keyword-stuffing" | "truncated"
  severity: "error" | "warning" | "info"
  message: string
}

export interface MetaDescriptionResult {
  description: string
  length: number
  pixelWidth: number
  issues: MetaIssue[]
  /** 0–100 quality score. */
  score: number
  strategy: "extractive" | "template" | "existing"
}

export interface MetaOptions {
  minLength?: number
  maxLength?: number
  /** Keep a passing existing description instead of regenerating. */
  keepExisting?: boolean
}

const DEFAULT_MIN = 120
const DEFAULT_MAX = 155
/** Approximate desktop SERP snippet width budget (Arial 14px ≈ 920px per line ×2 lines → Google trims ~920–990px). */
export const SNIPPET_PIXEL_LIMIT = 920
export const TITLE_PIXEL_LIMIT = 580

const DEFAULT_CTA: Record<PageType, string> = {
  page: "Learn more.",
  home: "Get started today.",
  article: "Read the full guide.",
  product: "Shop now.",
  collection: "Browse the collection.",
  local: "Visit us or call today.",
}

// Approximate Arial glyph widths at 1px font-size (relative units), good enough to warn about SERP truncation.
const NARROW = "ijlI.,;:'|!()[]{} ft"
const WIDE = "mwMW@%"
const CAPS = "ABCDEFGHKNOPQRSTUVXYZ"

/** Estimate rendered width (px) for Google's SERP font (Arial). */
export function estimatePixelWidth(text: string, fontSizePx = 14): number {
  let units = 0
  for (const ch of text) {
    if (NARROW.includes(ch)) units += 0.28
    else if (WIDE.includes(ch)) units += 0.83
    else if (CAPS.includes(ch)) units += 0.67
    else if (/[0-9]/.test(ch)) units += 0.556
    else units += 0.5
  }
  return Math.round(units * fontSizePx)
}

const JUNK = /(cookie|©|all rights reserved|privacy policy|terms of (use|service)|sign up for our newsletter|javascript|lorem ipsum|https?:\/\/|\bmenu\b|skip to content)/i
const WEAK_OPENERS = /^(it|this|that|they|these|those|he|she|here|there|also|and|but|so)\b/i

interface ScoredSentence {
  text: string
  index: number
  score: number
}

function scoreSentences(content: PageContent): ScoredSentence[] {
  const body = content.bodyText ?? ""
  const titleWords = new Set(contentWords(content.title ?? ""))
  const keywords = (content.keywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean)
  return sentences(body)
    .map((text, index) => {
      let score = 0
      const lower = text.toLowerCase()
      keywords.forEach((kw, i) => {
        if (lower.includes(kw)) score += i === 0 ? 4 : 2.5
      })
      for (const w of contentWords(text)) if (titleWords.has(w)) score += 0.8
      score += Math.max(0, 2 - index * 0.25) // lede bias
      score -= Math.abs(text.length - 140) / 60
      if (WEAK_OPENERS.test(text)) score -= 1.5
      if (text.endsWith("?")) score -= 0.5
      if (text.length < 40 || text.length > 260) score -= 3
      if (JUNK.test(text)) score -= 10
      if (text === text.toUpperCase() && /[A-Z]/.test(text)) score -= 3
      return { text, index, score }
    })
    .filter((s) => s.score > -5)
    .sort((a, b) => b.score - a.score)
}

/** Cut to `max`, preferring a clause boundary over a mid-sentence word boundary. */
function fitToLength(text: string, min: number, max: number): string {
  if (text.length <= max) return text
  const window = text.slice(0, max)
  const clause = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf(", "), window.lastIndexOf(" – "))
  if (clause >= min * 0.8) {
    const cut = window.slice(0, clause).replace(/[,;–\s]+$/, "")
    return /[.!?]$/.test(cut) ? cut : `${cut}.`
  }
  return truncateAtWord(text, max, "…")
}

function ensureSentenceEnd(text: string): string {
  const t = squish(text)
  if (!t) return t
  return /[.!?…]$/.test(t) ? t : `${t}.`
}

export function analyzeMetaDescription(
  description: string | null | undefined,
  context: Pick<PageContent, "keywords" | "title"> = {},
  { minLength = DEFAULT_MIN, maxLength = DEFAULT_MAX }: MetaOptions = {},
): { issues: MetaIssue[]; score: number; pixelWidth: number } {
  const text = squish(description ?? "")
  const issues: MetaIssue[] = []
  const pixelWidth = estimatePixelWidth(text)
  if (!text) {
    issues.push({ code: "missing", severity: "error", message: "Page has no meta description." })
    return { issues, score: 0, pixelWidth }
  }
  if (text.length < Math.min(70, minLength))
    issues.push({ code: "too-short", severity: "error", message: `Only ${text.length} characters — aim for ${minLength}–${maxLength}.` })
  else if (text.length < minLength)
    issues.push({ code: "too-short", severity: "warning", message: `${text.length} characters — room for ${minLength - text.length} more.` })
  if (text.length > maxLength + 5)
    issues.push({ code: "too-long", severity: "warning", message: `${text.length} characters — Google will likely truncate after ~${maxLength}.` })
  if (pixelWidth > SNIPPET_PIXEL_LIMIT)
    issues.push({ code: "too-wide", severity: "warning", message: `≈${pixelWidth}px wide; desktop snippets cut off around ${SNIPPET_PIXEL_LIMIT}px.` })
  if (text.endsWith("…"))
    issues.push({ code: "truncated", severity: "info", message: "Description ends mid-sentence." })
  const primary = context.keywords?.[0]?.toLowerCase()
  if (primary && !text.toLowerCase().includes(primary))
    issues.push({ code: "no-keyword", severity: "warning", message: `Primary keyword "${context.keywords![0]}" is missing.` })
  if (primary) {
    const occurrences = text.toLowerCase().split(primary).length - 1
    if (occurrences >= 3)
      issues.push({ code: "keyword-stuffing", severity: "warning", message: `"${context.keywords![0]}" appears ${occurrences}× — reads as stuffing.` })
  }
  if (context.title && squish(context.title).toLowerCase() === text.toLowerCase())
    issues.push({ code: "duplicate-title", severity: "warning", message: "Description just repeats the title." })

  const penalty = issues.reduce((sum, i) => sum + (i.severity === "error" ? 40 : i.severity === "warning" ? 15 : 5), 0)
  return { issues, score: Math.max(0, 100 - penalty), pixelWidth }
}

/**
 * Deterministic extractive meta description generator: ranks body sentences by keyword coverage,
 * title overlap, position and length, composes 120–155 characters and appends a CTA when there is room.
 */
export function generateMetaDescription(content: PageContent, options: MetaOptions = {}): MetaDescriptionResult {
  const minLength = options.minLength ?? DEFAULT_MIN
  const maxLength = options.maxLength ?? DEFAULT_MAX
  const finish = (description: string, strategy: MetaDescriptionResult["strategy"]): MetaDescriptionResult => {
    const analysis = analyzeMetaDescription(description, content, { minLength, maxLength })
    return { description, length: description.length, strategy, ...analysis }
  }

  if (options.keepExisting && content.existingDescription) {
    const existing = analyzeMetaDescription(content.existingDescription, content, { minLength, maxLength })
    if (!existing.issues.some((i) => i.severity !== "info")) return finish(squish(content.existingDescription), "existing")
  }

  const ranked = scoreSentences(content)
  const cta = ensureSentenceEnd(content.cta ?? DEFAULT_CTA[content.type ?? "page"])
  let description = ""
  let strategy: MetaDescriptionResult["strategy"] = "extractive"

  if (ranked.length > 0) {
    const best = ranked[0]!
    description = ensureSentenceEnd(best.text)
    if (description.length < minLength) {
      // Prefer the sentence that follows the lede for coherence, else the next best scorer.
      const follower = ranked.find((s) => s.index === best.index + 1) ?? ranked[1]
      if (follower) {
        const combined = `${description} ${ensureSentenceEnd(follower.text)}`
        if (combined.length <= maxLength) description = combined
      }
    }
    description = fitToLength(description, minLength, maxLength)
  } else {
    strategy = "template"
    const title = squish((content.title ?? content.headings?.[0] ?? "").split(/\s[|–—-]\s/)[0] ?? "")
    const subheads = (content.headings ?? []).filter((h) => squish(h) && squish(h) !== title).slice(0, 3)
    const kw = content.keywords?.[0]
    const parts: string[] = []
    if (title) parts.push(ensureSentenceEnd(content.brand && !title.includes(content.brand) ? `${title} by ${content.brand}` : title))
    if (subheads.length) parts.push(ensureSentenceEnd(`Explore ${subheads.map((h) => h.toLowerCase()).join(", ")}`))
    if (kw && !parts.join(" ").toLowerCase().includes(kw.toLowerCase())) parts.push(ensureSentenceEnd(capitalizeFirst(`Everything you need to know about ${kw}`)))
    description = fitToLength(parts.join(" "), minLength, maxLength)
  }

  // Keyword guarantee: if the primary keyword is missing and a short lead-in fits, add it.
  const primary = content.keywords?.[0]
  if (primary && !description.toLowerCase().includes(primary.toLowerCase())) {
    const lead = `${capitalizeFirst(primary)}: `
    if (description.length + lead.length <= maxLength) description = lead + description.charAt(0).toLowerCase() + description.slice(1)
  }

  if (description.length + 1 + cta.length <= maxLength && description.length < minLength + 20 && !description.endsWith("…")) {
    description = `${description} ${cta}`
  }
  return finish(squish(description), strategy)
}

export interface SeoTitleResult {
  title: string
  length: number
  pixelWidth: number
  truncated: boolean
}

/** Build an SEO title ≤ 60 chars: "Primary Title | Brand" when it fits. */
export function generateSeoTitle(content: PageContent, maxLength = 60): SeoTitleResult {
  let base = squish(content.title ?? content.headings?.[0] ?? "")
  const brand = content.brand ? squish(content.brand) : ""
  if (brand && base.toLowerCase().endsWith(brand.toLowerCase())) {
    base = base.slice(0, base.length - brand.length).replace(/[\s|–—:-]+$/, "")
  }
  const primary = content.keywords?.[0]
  if (!base && primary) base = capitalizeFirst(primary)
  let title = brand && base ? `${base} | ${brand}` : base || brand
  let truncated = false
  if (title.length > maxLength) {
    title = base.length <= maxLength ? base : truncateAtWord(base, maxLength)
    truncated = title !== base
  }
  return { title, length: title.length, pixelWidth: estimatePixelWidth(title, 20), truncated }
}

/** Unique-ness check across many pages (bulk CMS mode): returns indexes of duplicates. */
export function findDuplicateDescriptions(descriptions: string[]): number[][] {
  const groups = new Map<string, number[]>()
  descriptions.forEach((d, i) => {
    const key = words(d).join(" ")
    if (!key) return
    groups.set(key, [...(groups.get(key) ?? []), i])
  })
  return [...groups.values()].filter((g) => g.length > 1)
}
