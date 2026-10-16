import { describe, expect, it } from "vitest"
import {
  analyzeMetaDescription,
  estimatePixelWidth,
  findDuplicateDescriptions,
  generateMetaDescription,
  generateSeoTitle,
  sentences,
  truncateAtWord,
} from "../src/index.ts"

const BODY = `Welcome! Blue Door Coffee roasts single-origin beans in small batches every morning in San Francisco.
We source directly from farmers in Ethiopia, Colombia and Guatemala, paying above fair-trade prices.
Our café on Valencia Street serves pour-over, espresso and fresh pastries daily. © 2026 All rights reserved.`

describe("text utils", () => {
  it("splits sentences around abbreviations", () => {
    expect(sentences("We sell e.g. kettles. And mugs!")).toEqual(["We sell e.g. kettles.", "And mugs!"])
  })
  it("truncates at word boundaries", () => {
    expect(truncateAtWord("the quick brown fox jumps", 12)).toBe("the quick")
    expect(truncateAtWord("short", 12)).toBe("short")
  })
})

describe("generateMetaDescription", () => {
  it("produces a 120–155 char description containing the primary keyword", () => {
    const r = generateMetaDescription({ title: "Blue Door Coffee Roasters", bodyText: BODY, keywords: ["single-origin"] })
    expect(r.strategy).toBe("extractive")
    expect(r.description.length).toBeGreaterThanOrEqual(100)
    expect(r.description.length).toBeLessThanOrEqual(155)
    expect(r.description.toLowerCase()).toContain("single-origin")
    expect(r.description).not.toMatch(/rights reserved/)
  })

  it("is deterministic", () => {
    const input = { title: "x", bodyText: BODY }
    expect(generateMetaDescription(input)).toEqual(generateMetaDescription(input))
  })

  it("falls back to a template when there is no body text", () => {
    const r = generateMetaDescription({ title: "Pricing", headings: ["Starter", "Pro", "Enterprise"], brand: "Acme", type: "product" })
    expect(r.strategy).toBe("template")
    expect(r.description).toContain("Pricing by Acme")
    expect(r.description).toContain("starter, pro, enterprise")
  })

  it("adds the keyword as a lead-in when missing and appends a CTA when there is room", () => {
    const r = generateMetaDescription({
      bodyText: "We help small teams publish faster with less busywork and fewer meetings.",
      keywords: ["content ops"],
      cta: "Start free",
    })
    expect(r.description.startsWith("Content ops: we help")).toBe(true)
    expect(r.description.endsWith("Start free.")).toBe(true)
  })

  it("keeps a healthy existing description", () => {
    const existing = "Specialty coffee roasted daily in San Francisco. Order single-origin beans online or visit our Valencia Street café for pour-over and pastries."
    const r = generateMetaDescription({ existingDescription: existing, bodyText: BODY }, { keepExisting: true })
    expect(r.strategy).toBe("existing")
    expect(r.description).toBe(existing)
  })
})

describe("analyzeMetaDescription", () => {
  it("flags missing, short, long and stuffed descriptions", () => {
    expect(analyzeMetaDescription("").issues[0]!.code).toBe("missing")
    expect(analyzeMetaDescription("Too short.").issues[0]!.code).toBe("too-short")
    expect(analyzeMetaDescription("a ".repeat(100)).issues.map((i) => i.code)).toContain("too-long")
    const stuffed = analyzeMetaDescription("coffee coffee coffee beans, the best coffee in town for coffee lovers who love coffee and more coffee daily", { keywords: ["coffee"] })
    expect(stuffed.issues.map((i) => i.code)).toContain("keyword-stuffing")
  })
  it("scores a good description highly", () => {
    const r = analyzeMetaDescription(
      "Specialty coffee roasted daily in San Francisco. Order single-origin beans online or visit our Valencia Street café for pour-over and pastries.",
      { keywords: ["coffee"] },
    )
    expect(r.score).toBe(100)
  })
})

describe("SEO titles & pixel widths", () => {
  it("appends the brand when it fits", () => {
    expect(generateSeoTitle({ title: "Pour-Over Guide", brand: "Blue Door" }).title).toBe("Pour-Over Guide | Blue Door")
    expect(generateSeoTitle({ title: "Pour-Over Guide | Blue Door", brand: "Blue Door" }).title).toBe("Pour-Over Guide | Blue Door")
  })
  it("truncates long titles", () => {
    const r = generateSeoTitle({ title: "A".repeat(10) + " " + "word ".repeat(20), brand: "Brand" })
    expect(r.length).toBeLessThanOrEqual(60)
    expect(r.truncated).toBe(true)
  })
  it("estimates wider pixel widths for wide glyphs", () => {
    expect(estimatePixelWidth("MMMM")).toBeGreaterThan(estimatePixelWidth("iiii"))
  })
  it("finds duplicate descriptions across pages", () => {
    expect(findDuplicateDescriptions(["Hello world.", "Other", "hello  WORLD"])).toEqual([[0, 2]])
  })
})
