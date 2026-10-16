import { describe, expect, it } from "vitest"
import {
  auditAccessibility,
  compositeOver,
  contrastRatio,
  evaluateContrast,
  isLargeText,
  paletteMatrix,
  parseColor,
  relativeLuminance,
  simulateVision,
  suggestAccessibleColor,
  toHex,
  type AuditNode,
} from "../src/index.ts"

describe("parseColor", () => {
  it("parses hex, rgb, hsl and names", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor("#11111180")).toEqual({ r: 17, g: 17, b: 17, a: 0.502 })
    expect(parseColor("rgb(0, 153, 255)")).toEqual({ r: 0, g: 153, b: 255, a: 1 })
    expect(parseColor("rgba(0 153 255 / 50%)")).toEqual({ r: 0, g: 153, b: 255, a: 0.5 })
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor("rebeccapurple")).toEqual({ r: 102, g: 51, b: 153, a: 1 })
    expect(parseColor("not-a-color")).toBeNull()
    expect(parseColor("#12345")).toBeNull()
  })
  it("round-trips to hex", () => {
    expect(toHex(parseColor("#0099FF")!)).toBe("#0099ff")
  })
  it("composites alpha", () => {
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 })).toEqual({ r: 128, g: 128, b: 128, a: 1 })
  })
})

describe("WCAG contrast", () => {
  it("matches reference values", () => {
    expect(contrastRatio(parseColor("#000")!, parseColor("#fff")!)).toBeCloseTo(21, 5)
    expect(contrastRatio(parseColor("#fff")!, parseColor("#fff")!)).toBeCloseTo(1, 5)
    // #767676 on white is the famous 4.54:1 AA threshold color
    expect(contrastRatio(parseColor("#767676")!, parseColor("#fff")!)).toBeCloseTo(4.54, 2)
    expect(relativeLuminance(parseColor("#fff")!)).toBeCloseTo(1, 5)
  })

  it("never rounds a failing ratio up for display", () => {
    const r = evaluateContrast("#777777", "#ffffff")
    expect(r.ratio).toBeLessThan(4.5)
    expect(r.displayRatio).toBe("4.47")
    expect(r.aa).toBe(false)
  })

  it("applies large-text thresholds", () => {
    expect(isLargeText({ fontSizePx: 24 })).toBe(true)
    expect(isLargeText({ fontSizePx: 19, fontWeight: 700 })).toBe(true)
    expect(isLargeText({ fontSizePx: 19, fontWeight: 400 })).toBe(false)
    const r = evaluateContrast("#949494", "#ffffff", { fontSizePx: 32 })
    expect(r.aa).toBe(true)
    expect(evaluateContrast("#949494", "#ffffff").aa).toBe(false)
  })

  it("checks Framer dark UI tokens", () => {
    expect(evaluateContrast("#ffffff", "#111111").aaa).toBe(true)
    expect(evaluateContrast("#999999", "#111111").aa).toBe(true)
    expect(evaluateContrast("#555555", "#111111").aa).toBe(false)
  })

  it("composites translucent text over the background", () => {
    const solid = evaluateContrast("#ffffff", "#111111").ratio
    const translucent = evaluateContrast("rgba(255,255,255,0.5)", "#111111").ratio
    expect(translucent).toBeLessThan(solid)
  })

  it("throws on invalid colors", () => {
    expect(() => evaluateContrast("nope", "#fff")).toThrow(/Invalid color/)
  })
})

describe("suggestAccessibleColor", () => {
  it("returns passing colors with minimal change, hue preserved", () => {
    const suggestions = suggestAccessibleColor("#0099ff", "#ffffff", 4.5)
    expect(suggestions.length).toBeGreaterThan(0)
    const best = suggestions[0]!
    expect(best.ratio).toBeGreaterThanOrEqual(4.5)
    expect(evaluateContrast(best.color, "#ffffff").aa).toBe(true)
    const p = parseColor(best.color)!
    expect(p.b).toBeGreaterThan(p.r) // still blue
  })
  it("returns the original when already passing", () => {
    expect(suggestAccessibleColor("#000", "#fff")[0]!.delta).toBe(0)
  })
  it("supports AAA targets on dark backgrounds", () => {
    const best = suggestAccessibleColor("#666666", "#111111", 7)[0]!
    expect(best.ratio).toBeGreaterThanOrEqual(7)
  })
})

describe("simulateVision", () => {
  it("transforms colors deterministically", () => {
    expect(simulateVision("#ff0000", "achromatopsia")).toMatch(/^#([0-9a-f]{2})\1\1$/)
    expect(simulateVision("#ff0000", "protanopia")).not.toBe("#ff0000")
    expect(simulateVision("#ffffff", "deuteranopia")).toBe("#ffffff")
  })
})

describe("auditAccessibility", () => {
  const nodes: AuditNode[] = [
    { kind: "text", id: "h1", text: "Welcome", color: "#ffffff", background: "#111111", fontSizePx: 48, tag: "h1" },
    { kind: "text", id: "h3", text: "Skipped level", color: "#ffffff", background: "#111111", fontSizePx: 20, tag: "h3" },
    { kind: "text", id: "low", name: "Caption", text: "Low contrast caption", color: "#444444", background: "#111111", fontSizePx: 14 },
    { kind: "text", id: "tiny", text: "Fine print", color: "#ffffff", background: "#000000", fontSizePx: 10 },
    { kind: "text", id: "onimg", text: "Over photo", color: "#ffffff", background: null },
    { kind: "image", id: "img1", name: "Image", src: "https://cdn.test/team-offsite-lisbon.jpg", alt: null },
    { kind: "image", id: "img2", src: "https://cdn.test/a.jpg", alt: "Sunset over Lisbon rooftops" },
    { kind: "link", id: "l1", text: "click here", href: "/pricing", width: 80, height: 20 },
    { kind: "button", id: "b1", name: "Button 2", text: "", width: 40, height: 40 },
    { kind: "ui", id: "u1", name: "Input border", color: "#2a2a2a", background: "#111111" },
  ]

  it("finds contrast, alt, link, target, heading and structure issues", () => {
    const report = auditAccessibility({ nodes, page: { title: "Home", description: "", lang: "" } })
    const rules = report.issues.map((i) => i.rule)
    expect(rules).toContain("text-contrast")
    expect(rules).toContain("image-alt")
    expect(rules).toContain("generic-link-text")
    expect(rules).toContain("target-size")
    expect(rules).toContain("link-name")
    expect(rules).toContain("heading-order")
    expect(rules).toContain("small-text")
    expect(rules).toContain("contrast-unknown")
    expect(rules).toContain("non-text-contrast")
    expect(rules).toContain("html-lang")
    expect(rules).toContain("meta-description")
    expect(rules).not.toContain("page-title")
    // Sorted by severity
    expect(report.issues[0]!.severity).toBe("critical")
    expect(report.score).toBeLessThan(100)
  })

  it("provides actionable fixes", () => {
    const report = auditAccessibility({ nodes })
    const contrast = report.issues.find((i) => i.nodeId === "low")!
    expect(contrast.fix?.type).toBe("color")
    if (contrast.fix?.type === "color") expect(evaluateContrast(contrast.fix.value, "#111111").aa).toBe(true)
    const alt = report.issues.find((i) => i.nodeId === "img1")!
    expect(alt.fix).toEqual({ type: "alt", value: "Team offsite lisbon", decorative: false })
  })

  it("uses stricter thresholds for AAA", () => {
    const n: AuditNode[] = [{ kind: "text", id: "t", text: "Body", color: "#767676", background: "#ffffff", fontSizePx: 16 }]
    expect(auditAccessibility({ nodes: n, level: "AA" }).issues).toHaveLength(0)
    const aaa = auditAccessibility({ nodes: n, level: "AAA" })
    expect(aaa.issues[0]!.criterion).toBe("1.4.6")
    expect(aaa.issues[0]!.severity).toBe("moderate")
  })

  it("scores a clean page 100", () => {
    const clean = auditAccessibility({
      nodes: [
        { kind: "text", id: "h", text: "Title", color: "#fff", background: "#111", tag: "h1", fontSizePx: 32 },
        { kind: "image", id: "i", alt: "Barista pouring latte art" },
      ],
    })
    expect(clean.issues).toEqual([])
    expect(clean.score).toBe(100)
  })

  it("builds a palette matrix", () => {
    const m = paletteMatrix([
      { name: "Text", value: "#ffffff" },
      { name: "Bg", value: "#111111" },
    ])
    expect(m).toHaveLength(2)
    expect(m.every((p) => p.aaa)).toBe(true)
  })
})
