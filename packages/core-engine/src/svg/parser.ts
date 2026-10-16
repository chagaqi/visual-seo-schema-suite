/** Tiny, forgiving XML parser/serializer sufficient for SVG optimisation (no DTD/entity expansion). */

export interface SvgElement {
  type: "element"
  name: string
  attrs: Array<[string, string]>
  children: SvgNode[]
  selfClosing: boolean
}

export interface SvgText {
  type: "text"
  value: string
}

export interface SvgCData {
  type: "cdata"
  value: string
}

export interface SvgComment {
  type: "comment"
  value: string
}

export interface SvgDirective {
  type: "directive"
  /** Full raw text, e.g. `<?xml version="1.0"?>` or `<!DOCTYPE svg …>` */
  value: string
}

export type SvgNode = SvgElement | SvgText | SvgCData | SvgComment | SvgDirective

export interface SvgDocument {
  children: SvgNode[]
}

export class SvgParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SvgParseError"
  }
}

const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/y

export function parseSvg(source: string): SvgDocument {
  const root: SvgDocument = { children: [] }
  const stack: Array<SvgElement | SvgDocument> = [root]
  const top = () => stack[stack.length - 1]!
  let i = 0
  const len = source.length

  while (i < len) {
    const lt = source.indexOf("<", i)
    if (lt === -1) {
      const rest = source.slice(i)
      if (rest) top().children.push({ type: "text", value: rest })
      break
    }
    if (lt > i) top().children.push({ type: "text", value: source.slice(i, lt) })
    i = lt

    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4)
      if (end === -1) throw new SvgParseError("Unterminated comment")
      top().children.push({ type: "comment", value: source.slice(i + 4, end) })
      i = end + 3
      continue
    }
    if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i + 9)
      if (end === -1) throw new SvgParseError("Unterminated CDATA")
      top().children.push({ type: "cdata", value: source.slice(i + 9, end) })
      i = end + 3
      continue
    }
    if (source.startsWith("<?", i)) {
      const end = source.indexOf("?>", i + 2)
      if (end === -1) throw new SvgParseError("Unterminated processing instruction")
      top().children.push({ type: "directive", value: source.slice(i, end + 2) })
      i = end + 2
      continue
    }
    if (source.startsWith("<!", i)) {
      // DOCTYPE, possibly with an internal subset [ … ]
      let j = i + 2
      let depth = 0
      while (j < len) {
        const ch = source[j]
        if (ch === "[") depth++
        else if (ch === "]") depth--
        else if (ch === ">" && depth <= 0) break
        j++
      }
      top().children.push({ type: "directive", value: source.slice(i, j + 1) })
      i = j + 1
      continue
    }
    if (source.startsWith("</", i)) {
      const end = source.indexOf(">", i)
      if (end === -1) throw new SvgParseError("Unterminated closing tag")
      const name = source.slice(i + 2, end).trim()
      // Pop until we find the matching element (tolerates minor mis-nesting).
      for (let k = stack.length - 1; k > 0; k--) {
        const el = stack[k] as SvgElement
        if (el.name === name) {
          stack.length = k
          break
        }
        if (k === 1) throw new SvgParseError(`Unexpected closing tag </${name}>`)
      }
      i = end + 1
      continue
    }

    // Opening tag
    const nameMatch = /^<([A-Za-z_][\w:.-]*)/.exec(source.slice(i, i + 256))
    if (!nameMatch) {
      // Stray "<" in text.
      top().children.push({ type: "text", value: "<" })
      i++
      continue
    }
    const el: SvgElement = { type: "element", name: nameMatch[1]!, attrs: [], children: [], selfClosing: false }
    let j = i + nameMatch[0].length
    for (;;) {
      while (j < len && /\s/.test(source[j]!)) j++
      if (source.startsWith("/>", j)) {
        el.selfClosing = true
        j += 2
        break
      }
      if (source[j] === ">") {
        j++
        break
      }
      if (j >= len) throw new SvgParseError(`Unterminated tag <${el.name}>`)
      ATTR_RE.lastIndex = j
      const m = ATTR_RE.exec(source)
      if (!m || m.index !== j) throw new SvgParseError(`Malformed attribute in <${el.name}>`)
      el.attrs.push([m[1]!, m[2] ?? m[3] ?? m[4] ?? ""])
      j = ATTR_RE.lastIndex
    }
    top().children.push(el)
    if (!el.selfClosing) stack.push(el)
    i = j
  }
  if (stack.length > 1) throw new SvgParseError(`Unclosed element <${(stack[stack.length - 1] as SvgElement).name}>`)
  return root
}

function escapeAttr(value: string): string {
  return value.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}

export function serializeNode(node: SvgNode): string {
  switch (node.type) {
    case "text":
      return node.value
    case "cdata":
      return `<![CDATA[${node.value}]]>`
    case "comment":
      return `<!--${node.value}-->`
    case "directive":
      return node.value
    case "element": {
      const attrs = node.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("")
      if (node.children.length === 0) return `<${node.name}${attrs}/>`
      return `<${node.name}${attrs}>${node.children.map(serializeNode).join("")}</${node.name}>`
    }
  }
}

export function serializeSvg(doc: SvgDocument): string {
  return doc.children.map(serializeNode).join("")
}

export function getAttr(el: SvgElement, name: string): string | undefined {
  return el.attrs.find(([k]) => k === name)?.[1]
}

export function setAttr(el: SvgElement, name: string, value: string): void {
  const existing = el.attrs.find(([k]) => k === name)
  if (existing) existing[1] = value
  else el.attrs.push([name, value])
}

export function removeAttr(el: SvgElement, name: string): void {
  el.attrs = el.attrs.filter(([k]) => k !== name)
}

export function walk(nodes: SvgNode[], visit: (el: SvgElement) => void): void {
  for (const n of nodes) {
    if (n.type === "element") {
      visit(n)
      walk(n.children, visit)
    }
  }
}
