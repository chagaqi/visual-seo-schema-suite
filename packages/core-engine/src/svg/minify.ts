import { parseColor, toHex } from "../contrast/color.ts"
import { formatNumber, minifyPathData } from "./path.ts"
import {
  getAttr,
  parseSvg,
  removeAttr,
  serializeSvg,
  setAttr,
  type SvgElement,
  type SvgNode,
} from "./parser.ts"

export interface SvgMinifyOptions {
  /** Decimal places kept for coordinates (default 3). */
  precision?: number
  /** Keep <title> for accessibility (default true). */
  keepTitle?: boolean
  /** Keep <desc> (default false). */
  keepDesc?: boolean
  /** Strip scripts, event handlers, javascript: URLs and foreignObject (default true). */
  sanitize?: boolean
  /** Add a viewBox from width/height when missing (default true). */
  ensureViewBox?: boolean
  /** Remove width/height from the root so the SVG scales with CSS (default false). */
  responsive?: boolean
  /** Add role="img" + aria-label (default: none). Pass "" to mark decorative (aria-hidden). */
  ariaLabel?: string | null
}

export interface SvgMinifyResult {
  svg: string
  originalBytes: number
  minifiedBytes: number
  /** 0–100 */
  savingsPercent: number
  warnings: string[]
  removedElements: number
}

const EDITOR_NS = /^(inkscape|sodipodi|sketch|serif|figma|i|x|graph|a|dc|cc|rdf|adobe|ns\d+|vectornator|bx|krita)$/i
const EDITOR_ELEMENTS = /^(sodipodi:|inkscape:|sketch:|serif:|figma:|i:|x:|rdf:|dc:|cc:)/i
const NUMERIC_ATTRS = new Set([
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "width", "height",
  "stroke-width", "stroke-miterlimit", "stroke-dashoffset", "opacity", "fill-opacity", "stroke-opacity",
  "stop-opacity", "offset", "font-size", "letter-spacing", "dx", "dy", "refX", "refY", "markerWidth", "markerHeight",
])
const LIST_ATTRS = new Set(["viewBox", "points", "stroke-dasharray"])
const COLOR_ATTRS = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"])
const PRESERVE_WHITESPACE = new Set(["text", "tspan", "textPath", "title", "desc", "style", "script", "pre"])
const REMOVABLE_ROOT_ATTRS = new Set(["version", "baseProfile", "enable-background", "xml:space", "data-name", "style"])

const SHORT_NAMES: Record<string, string> = {
  "#ff0000": "red", "#f00": "red", "#d2b48c": "tan", "#ffa500": "orange", "#808080": "gray", "#008000": "green",
  "#800000": "maroon", "#000080": "navy", "#808000": "olive", "#800080": "purple", "#c0c0c0": "silver",
  "#008080": "teal", "#ee82ee": "violet", "#f5deb3": "wheat", "#fa8072": "salmon", "#ff7f50": "coral",
  "#ffc0cb": "pink", "#dda0dd": "plum", "#a0522d": "sienna", "#fffafa": "snow", "#ff6347": "tomato",
  "#40e0d0": "turquoise", "#4b0082": "indigo", "#fffff0": "ivory", "#f0e68c": "khaki", "#faf0e6": "linen",
  "#ffe4c4": "bisque", "#f5f5dc": "beige", "#a52a2a": "brown", "#ffd700": "gold",
}

/** Shortest equivalent color literal (#ffffff → #fff, rgb(255,0,0) → red). Non-colors pass through. */
export function minifyColor(value: string): string {
  const v = value.trim()
  if (/^(none|currentcolor|inherit|transparent)$/i.test(v)) return v.toLowerCase() === "currentcolor" ? "currentColor" : v.toLowerCase()
  if (/^url\(/i.test(v) || /^var\(/i.test(v)) return v
  const c = parseColor(v)
  if (!c || c.a < 1) return v
  let hex = toHex(c, false)
  if (/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/.test(hex)) hex = `#${hex[1]}${hex[3]}${hex[5]}`
  const named = SHORT_NAMES[hex]
  return named && named.length < hex.length ? named : hex
}

function minifyNumberList(value: string, precision: number): string {
  const parts = value.trim().split(/[\s,]+/).filter(Boolean)
  if (parts.some((p) => Number.isNaN(Number(p)))) return value.trim().replace(/\s+/g, " ")
  return parts.map((p) => formatNumber(Number(p), precision)).join(" ")
}

function minifyCss(css: string, precision: number): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .replace(/(#[0-9a-fA-F]{6})\b/g, (m) => minifyColor(m))
    .replace(/(\d+\.\d{4,})/g, (m) => formatNumber(Number(m), precision))
    .trim()
}

function minifyStyleAttr(style: string, precision: number): string {
  return style
    .split(";")
    .map((decl) => decl.trim())
    .filter(Boolean)
    .map((decl) => {
      const idx = decl.indexOf(":")
      if (idx === -1) return decl
      const prop = decl.slice(0, idx).trim().toLowerCase()
      let val = decl.slice(idx + 1).trim()
      if (COLOR_ATTRS.has(prop)) val = minifyColor(val)
      else val = minifyCss(val, precision)
      return `${prop}:${val}`
    })
    .join(";")
}

function isUnsafeUrl(value: string): boolean {
  const v = value.replace(/[\s\u0000-\u001f]/g, "").toLowerCase()
  return v.startsWith("javascript:") || v.startsWith("vbscript:") || v.startsWith("data:text/html")
}

/**
 * Optimise an SVG string: strip editor cruft, comments, metadata, unsafe content; round numbers;
 * compact path data and colors; collapse whitespace; ensure a viewBox. Typically saves 20–70%.
 */
export function minifySvg(input: string, options: SvgMinifyOptions = {}): SvgMinifyResult {
  const {
    precision = 3,
    keepTitle = true,
    keepDesc = false,
    sanitize = true,
    ensureViewBox = true,
    responsive = false,
    ariaLabel = null,
  } = options
  const warnings: string[] = []
  let removedElements = 0
  const originalBytes = new TextEncoder().encode(input).length

  const doc = parseSvg(input.replace(/^﻿/, ""))
  const rootSvg = doc.children.find((n): n is SvgElement => n.type === "element" && n.name === "svg")
  if (!rootSvg) throw new Error("No <svg> root element found")

  const usesXlink = /xlink:/.test(input.replace(/xmlns:xlink="[^"]*"/, ""))

  const prune = (nodes: SvgNode[], parent: SvgElement | null): SvgNode[] => {
    const out: SvgNode[] = []
    for (const node of nodes) {
      if (node.type === "comment") {
        // Preserve legal comments (<!--! … -->)
        if (node.value.startsWith("!")) out.push(node)
        continue
      }
      if (node.type === "directive") continue
      if (node.type === "text") {
        if (parent && PRESERVE_WHITESPACE.has(parent.name)) {
          out.push(node)
        } else if (node.value.trim()) {
          out.push({ type: "text", value: node.value.replace(/\s+/g, " ").trim() })
        }
        continue
      }
      if (node.type === "cdata") {
        if (parent?.name === "style") out.push({ type: "text", value: minifyCss(node.value, precision).replace(/</g, "\\3c ") })
        else out.push(node)
        continue
      }
      const el = node
      const name = el.name
      if (
        name === "metadata" ||
        EDITOR_ELEMENTS.test(name) ||
        (name === "title" && !keepTitle) ||
        (name === "desc" && !keepDesc)
      ) {
        removedElements++
        continue
      }
      if (sanitize && (name === "script" || name === "foreignObject" || name === "iframe" || name === "embed" || name === "object")) {
        removedElements++
        warnings.push(`Removed unsafe <${name}> element`)
        continue
      }

      // Attributes
      el.attrs = el.attrs.filter(([k, v]) => {
        const lower = k.toLowerCase()
        if (lower.startsWith("xmlns:")) {
          const prefix = k.slice(6)
          if (EDITOR_NS.test(prefix)) return false
          if (prefix === "xlink" && !usesXlink) return false
        }
        const nsPrefix = k.includes(":") ? k.split(":")[0]! : null
        if (nsPrefix && nsPrefix !== "xlink" && nsPrefix !== "xml" && nsPrefix !== "xmlns" && EDITOR_NS.test(nsPrefix)) return false
        if (lower === "data-name" || (lower === "class" && v.trim() === "")) return false
        if (sanitize && lower.startsWith("on")) {
          warnings.push(`Removed event handler ${k}`)
          return false
        }
        if (sanitize && (lower === "href" || lower === "xlink:href") && isUnsafeUrl(v)) {
          warnings.push("Removed javascript: URL")
          return false
        }
        if (v.trim() === "" && !["alt", "aria-label"].includes(lower)) return false
        // Editor ids ("Layer_1", "Path-3") that nothing references.
        if (lower === "id" && !input.includes(`#${v}`) && name !== "style" && name !== "script") return false
        return true
      })

      for (const attr of el.attrs) {
        const [k, v] = attr
        if (k === "d") attr[1] = minifyPathData(v, precision)
        else if (NUMERIC_ATTRS.has(k) && /^-?[\d.]+(e-?\d+)?(px)?$/i.test(v.trim())) attr[1] = formatNumber(parseFloat(v), precision)
        else if (LIST_ATTRS.has(k)) attr[1] = minifyNumberList(v, precision)
        else if (COLOR_ATTRS.has(k)) attr[1] = minifyColor(v)
        else if (k === "style") attr[1] = minifyStyleAttr(v, precision)
        else if (k === "transform") attr[1] = v.replace(/\s*,\s*|\s+/g, " ").replace(/(\d+\.\d+)/g, (m) => formatNumber(Number(m), precision + 2)).replace(/\(\s+|\s+\)/g, (m) => m.trim())
      }
      el.attrs = el.attrs.filter(([k, v]) => !(k === "style" && v === ""))

      if (name === "style") {
        el.children = el.children.map((c) =>
          c.type === "text" || c.type === "cdata" ? { type: "text" as const, value: minifyCss(c.value, precision) } : c,
        )
      }

      el.children = prune(el.children, el)

      // Unwrap attribute-less groups; drop empty containers.
      if ((name === "g" || name === "defs") && el.children.length === 0 && !getAttr(el, "id")) {
        removedElements++
        continue
      }
      if (name === "g" && el.attrs.length === 0) {
        out.push(...el.children)
        removedElements++
        continue
      }
      out.push(el)
    }
    return out
  }

  doc.children = prune(doc.children, null)
  const svg = doc.children.find((n): n is SvgElement => n.type === "element" && n.name === "svg")!

  for (const attr of [...svg.attrs]) {
    if (REMOVABLE_ROOT_ATTRS.has(attr[0]) && attr[0] !== "style") removeAttr(svg, attr[0])
  }
  if (/^0(px)?$/.test(getAttr(svg, "x") ?? "")) removeAttr(svg, "x")
  if (/^0(px)?$/.test(getAttr(svg, "y") ?? "")) removeAttr(svg, "y")
  if (!getAttr(svg, "xmlns")) svg.attrs.unshift(["xmlns", "http://www.w3.org/2000/svg"])

  const width = getAttr(svg, "width")
  const height = getAttr(svg, "height")
  if (ensureViewBox && !getAttr(svg, "viewBox")) {
    const w = width ? parseFloat(width) : NaN
    const h = height ? parseFloat(height) : NaN
    if (!Number.isNaN(w) && !Number.isNaN(h) && !/%/.test(width! + height!)) {
      setAttr(svg, "viewBox", `0 0 ${formatNumber(w, precision)} ${formatNumber(h, precision)}`)
    } else {
      warnings.push("No viewBox and no numeric width/height — the SVG may not scale correctly.")
    }
  }
  if (responsive && getAttr(svg, "viewBox")) {
    removeAttr(svg, "width")
    removeAttr(svg, "height")
  }
  if (ariaLabel !== null) {
    if (ariaLabel === "") {
      setAttr(svg, "aria-hidden", "true")
      removeAttr(svg, "role")
    } else {
      setAttr(svg, "role", "img")
      setAttr(svg, "aria-label", ariaLabel)
    }
  }

  const output = serializeSvg(doc).trim()
  const minifiedBytes = new TextEncoder().encode(output).length
  return {
    svg: output,
    originalBytes,
    minifiedBytes,
    savingsPercent: originalBytes === 0 ? 0 : Math.max(0, Math.round((1 - minifiedBytes / originalBytes) * 1000) / 10),
    warnings: [...new Set(warnings)],
    removedElements,
  }
}

/** Quick validity check used by the UI before inserting into the canvas. */
export function isLikelySvg(input: string): boolean {
  return /<svg[\s>]/i.test(input) && /<\/svg>\s*$/i.test(input.trim())
}
