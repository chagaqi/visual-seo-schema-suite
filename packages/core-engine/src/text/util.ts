/** Small, dependency-free text helpers shared by the alt-text and meta generators. */

export const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is", "it", "its",
  "of", "on", "or", "that", "the", "to", "was", "were", "will", "with", "your", "you", "our", "we",
  "this", "these", "those", "into", "over", "about", "can", "how", "what", "why", "when",
])

/** Collapse whitespace and trim. */
export function squish(input: string): string {
  return input.replace(/\s+/g, " ").trim()
}

/** Upper-case the first character, leave the rest untouched (keeps acronyms and brand casing). */
export function capitalizeFirst(input: string): string {
  if (!input) return input
  return input.charAt(0).toUpperCase() + input.slice(1)
}

/** Lower-case a word unless it looks like an acronym or a proper brand token (e.g. "iPhone", "SEO"). */
export function softLower(word: string): string {
  if (/^[A-Z0-9]{2,}$/.test(word)) return word
  if (/^[a-z]+[A-Z]/.test(word)) return word
  return word.toLowerCase()
}

/**
 * Truncate at a word boundary so the result is at most `max` characters.
 * Trailing punctuation fragments are cleaned up; an optional suffix (e.g. "…") is appended when cut.
 */
export function truncateAtWord(input: string, max: number, suffix = ""): string {
  const text = squish(input)
  if (text.length <= max) return text
  const budget = Math.max(0, max - suffix.length)
  let cut = text.slice(0, budget + 1)
  const lastSpace = cut.lastIndexOf(" ")
  cut = lastSpace > budget * 0.5 ? cut.slice(0, lastSpace) : text.slice(0, budget)
  cut = cut.replace(/[\s,;:\-–—(]+$/u, "")
  return cut + suffix
}

/** Split into lowercase word tokens (letters/digits, unicode aware). */
export function words(input: string): string[] {
  return (input.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).map((w) =>
    w.replace(/['’]s$/u, ""),
  )
}

/** Content words: tokens minus stopwords and 1-char noise. */
export function contentWords(input: string): string[] {
  return words(input).filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

/** Split text into sentences, keeping terminal punctuation. Handles common abbreviations. */
export function sentences(input: string): string[] {
  const text = squish(input)
  if (!text) return []
  const protectedText = text.replace(/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Inc|Ltd|St|No)\./g, (m) =>
    m.replace(/\./g, "\u0000"),
  )
  const parts = protectedText.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [protectedText]
  return parts.map((s) => squish(s.replace(/\u0000/g, "."))).filter((s) => s.length > 0)
}

/** Remove duplicate consecutive words ("logo logo" → "logo"), case-insensitive. */
export function dedupeAdjacent(tokens: string[]): string[] {
  const out: string[] = []
  for (const t of tokens) {
    const prev = out[out.length - 1]
    if (prev && prev.toLowerCase() === t.toLowerCase()) continue
    out.push(t)
  }
  return out
}

/** Join list items in natural language: ["a","b","c"] → "a, b and c". */
export function naturalJoin(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/** Fast 32-bit FNV-1a hash, used for deterministic choices and cache keys. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Escape a string for safe inclusion in HTML text or attribute values. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
