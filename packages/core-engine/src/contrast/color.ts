/** Color parsing & conversion (sRGB). Values: r,g,b 0–255, a 0–1. */

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface HSLA {
  h: number
  s: number
  l: number
  a: number
}

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000",
  navy: "#000080", teal: "#008080", olive: "#808000", lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff",
  fuchsia: "#ff00ff", magenta: "#ff00ff", pink: "#ffc0cb", brown: "#a52a2a", gold: "#ffd700", indigo: "#4b0082",
  violet: "#ee82ee", coral: "#ff7f50", salmon: "#fa8072", tomato: "#ff6347", crimson: "#dc143c", khaki: "#f0e68c",
  beige: "#f5f5dc", ivory: "#fffff0", lavender: "#e6e6fa", turquoise: "#40e0d0", tan: "#d2b48c", chocolate: "#d2691e",
  darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3", lightgrey: "#d3d3d3", dimgray: "#696969",
  whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc", slategray: "#708090", darkblue: "#00008b", darkred: "#8b0000",
  darkgreen: "#006400", rebeccapurple: "#663399", transparent: "#00000000",
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function parseChannel(value: string, max: number): number {
  const v = value.trim()
  if (v.endsWith("%")) return (parseFloat(v) / 100) * max
  return parseFloat(v)
}

function parseAlpha(value: string | undefined): number {
  if (value === undefined) return 1
  const v = value.trim()
  if (v.endsWith("%")) return clamp(parseFloat(v) / 100, 0, 1)
  return clamp(parseFloat(v), 0, 1)
}

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla() (comma or space syntax) and common names. */
export function parseColor(input: string): RGBA | null {
  if (!input) return null
  let s = input.trim().toLowerCase()
  if (NAMED[s]) s = NAMED[s]!
  if (s.startsWith("#")) {
    let hex = s.slice(1)
    if (!/^[0-9a-f]+$/.test(hex)) return null
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("")
    if (hex.length !== 6 && hex.length !== 8) return null
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 }
  }
  const fn = s.match(/^(rgba?|hsla?)\((.*)\)$/)
  if (!fn) return null
  const kind = fn[1]!
  const parts = fn[2]!.trim().split(/\s*[,/]\s*|\s+/).filter(Boolean)
  if (parts.length < 3) return null
  if (kind.startsWith("rgb")) {
    const [r, g, b] = parts.slice(0, 3).map((p) => clamp(Math.round(parseChannel(p, 255)), 0, 255))
    if ([r, g, b].some((x) => Number.isNaN(x))) return null
    return { r: r!, g: g!, b: b!, a: parseAlpha(parts[3]) }
  }
  const h = parseFloat(parts[0]!.replace("deg", ""))
  const sat = parseFloat(parts[1]!) / 100
  const light = parseFloat(parts[2]!) / 100
  if ([h, sat, light].some((x) => Number.isNaN(x))) return null
  return hslToRgb({ h, s: clamp(sat, 0, 1), l: clamp(light, 0, 1), a: parseAlpha(parts[3]) })
}

export function toHex({ r, g, b, a }: RGBA, includeAlpha = a < 1): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}${includeAlpha ? h(a * 255) : ""}`
}

export function rgbToHsl({ r, g, b, a }: RGBA): HSLA {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
  }
  return { h, s, l, a }
}

export function hslToRgb({ h, s, l, a }: HSLA): RGBA {
  const hh = (((h % 360) + 360) % 360) / 360
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v, a }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return {
    r: Math.round(hue(hh + 1 / 3) * 255),
    g: Math.round(hue(hh) * 255),
    b: Math.round(hue(hh - 1 / 3) * 255),
    a,
  }
}

/** Alpha-composite `fg` over an opaque `bg`. */
export function compositeOver(fg: RGBA, bg: RGBA): RGBA {
  const base = bg.a < 1 ? compositeOver(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg
  const a = fg.a
  return {
    r: Math.round(fg.r * a + base.r * (1 - a)),
    g: Math.round(fg.g * a + base.g * (1 - a)),
    b: Math.round(fg.b * a + base.b * (1 - a)),
    a: 1,
  }
}
