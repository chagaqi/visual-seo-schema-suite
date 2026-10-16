import { contentWords, squish } from "../text/util.ts"
import type { JsonLdObject, JsonLdValue } from "./build.ts"

/**
 * Serialise JSON-LD for embedding inside `<script type="application/ld+json">`.
 * Escapes characters that could terminate the script element or break JS parsers (XSS-safe).
 */
export function serializeJsonLd(jsonld: JsonLdValue, pretty = false): string {
  return JSON.stringify(jsonld, null, pretty ? 2 : undefined)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029")
}

export const VSS_SCRIPT_ID = "vss-structured-data"

export function toScriptTag(jsonld: JsonLdValue, { pretty = false, id = VSS_SCRIPT_ID }: { pretty?: boolean; id?: string | null } = {}): string {
  const idAttr = id ? ` id="${id.replace(/[^\w-]/g, "")}"` : ""
  return `<script type="application/ld+json"${idAttr}>${serializeJsonLd(jsonld, pretty)}</script>`
}

/**
 * Inline JS loader for hosts that only accept JavaScript in custom code (e.g. Webflow registered
 * inline scripts): injects the JSON-LD into <head> at runtime. Google renders JS-injected JSON-LD.
 */
export function toInjectorScript(jsonld: JsonLdValue, id = VSS_SCRIPT_ID): string {
  const payload = JSON.stringify(serializeJsonLd(jsonld))
  const safeId = JSON.stringify(id.replace(/[^\w-]/g, ""))
  return `(function(){var d=document,i=${safeId},s=d.getElementById(i);if(!s){s=d.createElement("script");s.type="application/ld+json";s.id=i;d.head.appendChild(s)}s.textContent=${payload}})();`
}

/** Extract every JSON-LD block from an HTML string. Invalid blocks are returned with `error`. */
export function extractJsonLd(html: string): Array<{ json: JsonLdValue | null; raw: string; error?: string }> {
  const out: Array<{ json: JsonLdValue | null; raw: string; error?: string }> = []
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const raw = m[1]!.trim()
    try {
      out.push({ json: JSON.parse(raw) as JsonLdValue, raw })
    } catch (e) {
      out.push({ json: null, raw, error: (e as Error).message })
    }
  }
  return out
}

export interface ContentSection {
  heading: string
  text: string
}

/**
 * Auto-detect FAQ pairs from page sections: headings phrased as questions followed by an answer.
 * Feeds the FAQPage builder so users start from their real content.
 */
export function extractFaqPairs(sections: ContentSection[], max = 20): Array<{ name: string; "acceptedAnswer.text": string }> {
  const QUESTION_START = /^(who|what|when|where|why|how|can|do|does|did|is|are|will|should|could|would|which)\b/i
  return sections
    .map((s) => ({ q: squish(s.heading), a: squish(s.text) }))
    .filter(({ q, a }) => (q.endsWith("?") || QUESTION_START.test(q)) && contentWords(a).length >= 3)
    .slice(0, max)
    .map(({ q, a }) => ({ name: q.endsWith("?") ? q : `${q}?`, "acceptedAnswer.text": a }))
}

/** Strip HTML that Google doesn't allow inside FAQ answers. Keeps p, a, ul, ol, li, b, strong, i, em, br, h2–h6. */
export function sanitizeAnswerHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(?!\/?(p|a|ul|ol|li|b|strong|i|em|br|h[2-6])\b)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*(["'])\s*javascript:[^"']*\1/gi, 'href="#"')
}

export function isJsonLdObject(value: JsonLdValue | undefined): value is JsonLdObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
