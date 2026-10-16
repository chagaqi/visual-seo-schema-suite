import { compositeOver, hslToRgb, parseColor, rgbToHsl, toHex, type RGBA } from "./color.ts"

/** WCAG 2.x relative luminance. */
export function relativeLuminance({ r, g, b }: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Contrast ratio 1–21. Translucent foregrounds are composited over the background first. */
export function contrastRatio(foreground: RGBA, background: RGBA): number {
  const bg = background.a < 1 ? compositeOver(background, { r: 255, g: 255, b: 255, a: 1 }) : background
  const fg = foreground.a < 1 ? compositeOver(foreground, bg) : foreground
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

export type WcagLevel = "AA" | "AAA"

export interface TextSize {
  fontSizePx?: number
  fontWeight?: number
}

/** WCAG "large text": ≥ 24px (18pt) regular, or ≥ 18.66px (14pt) bold (≥700). */
export function isLargeText({ fontSizePx = 16, fontWeight = 400 }: TextSize = {}): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
}

export function requiredRatio(level: WcagLevel, large: boolean): number {
  if (level === "AAA") return large ? 4.5 : 7
  return large ? 3 : 4.5
}

export interface ContrastResult {
  ratio: number
  /** Ratio rounded down to 2 decimals as WCAG tools display it (never round a fail up to a pass). */
  displayRatio: string
  largeText: boolean
  aa: boolean
  aaa: boolean
  /** 1.4.11 non-text contrast (UI components, focus rings, icons): 3:1. */
  nonText: boolean
  foreground: string
  background: string
}

export function evaluateContrast(fg: string | RGBA, bg: string | RGBA, size: TextSize = {}): ContrastResult {
  const f = typeof fg === "string" ? parseColor(fg) : fg
  const b = typeof bg === "string" ? parseColor(bg) : bg
  if (!f || !b) throw new Error(`Invalid color: ${!f ? String(fg) : String(bg)}`)
  const ratio = contrastRatio(f, b)
  const large = isLargeText(size)
  return {
    ratio,
    displayRatio: (Math.floor(ratio * 100) / 100).toFixed(2),
    largeText: large,
    aa: ratio >= requiredRatio("AA", large),
    aaa: ratio >= requiredRatio("AAA", large),
    nonText: ratio >= 3,
    foreground: toHex(f),
    background: toHex(b),
  }
}

export interface ColorSuggestion {
  color: string
  ratio: number
  /** Perceptual-ish distance from the original (lightness delta, 0–1). */
  delta: number
}

/**
 * Find the closest color (same hue & saturation, adjusted lightness) that meets `target` against `bg`.
 * Tries both darker and lighter directions and returns the smaller change first.
 */
export function suggestAccessibleColor(fg: string, bg: string, target = 4.5): ColorSuggestion[] {
  const f = parseColor(fg)
  const b = parseColor(bg)
  if (!f || !b) return []
  if (contrastRatio(f, b) >= target) return [{ color: toHex(f), ratio: contrastRatio(f, b), delta: 0 }]
  const hsl = rgbToHsl({ ...f, a: 1 })
  const results: ColorSuggestion[] = []
  for (const direction of [-1, 1] as const) {
    const bound = direction === -1 ? 0 : 1
    const atBound = hslToRgb({ ...hsl, l: bound })
    if (contrastRatio(atBound, b) < target) continue
    // Binary search the smallest lightness change that reaches the target.
    let lo = hsl.l
    let hi = bound
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (contrastRatio(hslToRgb({ ...hsl, l: mid }), b) >= target) hi = mid
      else lo = mid
    }
    let candidate = hslToRgb({ ...hsl, l: hi })
    // Rounding to 8-bit can dip just under the target: nudge until it passes.
    let guard = 0
    while (contrastRatio(candidate, b) < target && guard++ < 50) {
      const l = rgbToHsl(candidate).l + direction * 0.002
      candidate = hslToRgb({ ...hsl, l: Math.min(1, Math.max(0, l)) })
    }
    results.push({ color: toHex(candidate), ratio: contrastRatio(candidate, b), delta: Math.abs(hi - hsl.l) })
  }
  return results.sort((a, b2) => a.delta - b2.delta)
}

/** Simulate common color-vision deficiencies (Machado et al. 2009, severity 1.0). */
export type VisionDeficiency = "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia"

const CVD_MATRICES: Record<Exclude<VisionDeficiency, "achromatopsia">, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
}

export function simulateVision(color: string, type: VisionDeficiency): string {
  const c = parseColor(color)
  if (!c) return color
  if (type === "achromatopsia") {
    const y = Math.round(relativeLuminance(c) ** (1 / 2.2) * 255)
    return toHex({ r: y, g: y, b: y, a: c.a })
  }
  const m = CVD_MATRICES[type]
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const enc = (v: number) => {
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, s)) * 255)
  }
  const [r, g, b] = [lin(c.r), lin(c.g), lin(c.b)]
  return toHex({
    r: enc(m[0]! * r + m[1]! * g + m[2]! * b),
    g: enc(m[3]! * r + m[4]! * g + m[5]! * b),
    b: enc(m[6]! * r + m[7]! * g + m[8]! * b),
    a: c.a,
  })
}
