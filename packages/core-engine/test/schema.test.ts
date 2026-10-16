import { describe, expect, it } from "vitest"
import {
  SCHEMA_DEFINITIONS,
  SCHEMA_TYPES,
  buildJsonLd,
  combineGraph,
  emptyFormData,
  extractFaqPairs,
  extractJsonLd,
  jsonLdToFormData,
  resolvePath,
  sanitizeAnswerHtml,
  serializeJsonLd,
  toInjectorScript,
  toScriptTag,
  validateJsonLd,
} from "../src/index.ts"

describe("schema definitions", () => {
  it("covers the five supported types", () => {
    expect(SCHEMA_TYPES).toEqual(["LocalBusiness", "Product", "FAQPage", "Article", "SoftwareApplication"])
  })

  it.each(SCHEMA_TYPES)("%s example builds into valid, rich-result eligible JSON-LD", (type) => {
    const jsonld = buildJsonLd(type, SCHEMA_DEFINITIONS[type].example)
    const result = validateJsonLd(jsonld)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.richResultEligible).toBe(true)
    expect(jsonld["@context"]).toBe("https://schema.org")
  })

  it("empty form data reports required fields", () => {
    const result = validateJsonLd(buildJsonLd("Product", emptyFormData("Product")))
    expect(result.valid).toBe(false)
    expect(result.errors.map((e) => e.path)).toContain("name")
  })
})

describe("buildJsonLd", () => {
  it("nests dotted keys into typed objects and converts values", () => {
    const jsonld = buildJsonLd("Product", {
      name: "Kettle",
      "offers.price": "$1,299.50",
      "offers.priceCurrency": "USD",
      "offers.availability": "InStock",
      "brand.name": "Acme",
      description: "   ",
    })
    expect(jsonld).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Kettle",
      brand: { "@type": "Brand", name: "Acme" },
      offers: { "@type": "Offer", price: 1299.5, priceCurrency: "USD", availability: "https://schema.org/InStock" },
    })
  })

  it("builds FAQ questions with accepted answers", () => {
    const jsonld = buildJsonLd("FAQPage", { mainEntity: [{ name: "Q?", "acceptedAnswer.text": "A." }, { name: "", "acceptedAnswer.text": "" }] })
    expect(jsonld.mainEntity).toEqual([{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } }])
  })

  it("builds opening hours and the selected subtype", () => {
    const jsonld = buildJsonLd("LocalBusiness", {
      "@type": "Restaurant",
      name: "Taqueria",
      "address.streetAddress": "1 Main St",
      "address.addressLocality": "Austin",
      openingHoursSpecification: [{ dayOfWeek: ["Monday"], opens: "9:00", closes: "17:00" }],
      sameAs: "https://instagram.com/x\nhttps://yelp.com/x",
    })
    expect(jsonld["@type"]).toBe("Restaurant")
    expect(jsonld.openingHoursSpecification).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday"], opens: "09:00", closes: "17:00" },
    ])
    expect(jsonld.sameAs).toEqual(["https://instagram.com/x", "https://yelp.com/x"])
  })

  it("wraps the Article canonical URL in a WebPage", () => {
    const jsonld = buildJsonLd("Article", { headline: "H", mainEntityOfPage: "https://e.com/a" })
    expect(jsonld.mainEntityOfPage).toEqual({ "@type": "WebPage", "@id": "https://e.com/a" })
  })

  it("round-trips through jsonLdToFormData", () => {
    for (const type of SCHEMA_TYPES) {
      const example = SCHEMA_DEFINITIONS[type].example
      const jsonld = buildJsonLd(type, example)
      expect(buildJsonLd(type, jsonLdToFormData(type, jsonld))).toEqual(jsonld)
    }
  })

  it("combines multiple objects into an @graph", () => {
    const a = buildJsonLd("FAQPage", SCHEMA_DEFINITIONS.FAQPage.example)
    const b = buildJsonLd("Article", SCHEMA_DEFINITIONS.Article.example)
    const graph = combineGraph([a, b])
    expect(graph["@graph"]).toHaveLength(2)
    expect((graph["@graph"] as Array<Record<string, unknown>>)[0]!["@context"]).toBeUndefined()
    expect(validateJsonLd(graph).valid).toBe(true)
    expect(combineGraph([a])).toBe(a)
  })
})

describe("validateJsonLd", () => {
  it("rejects invalid JSON and missing context/type", () => {
    expect(validateJsonLd("{oops").errors[0]!.message).toMatch(/Invalid JSON/)
    const r = validateJsonLd({ name: "x" })
    expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["@context", "@type"]))
  })

  it("validates formats: URLs, dates, currency, ratings, geo, gtin", () => {
    const r = validateJsonLd({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "X",
      image: "/relative.jpg",
      gtin: "123",
      offers: { "@type": "Offer", price: "ten", priceCurrency: "usd", priceValidUntil: "next week" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: 7 },
      geo: { latitude: 120, longitude: 0 },
    })
    const messages = r.errors.map((e) => e.message).join("\n")
    expect(messages).toMatch(/absolute URL/)
    expect(messages).toMatch(/GTIN/)
    expect(messages).toMatch(/number/)
    expect(messages).toMatch(/ISO 4217/)
    expect(messages).toMatch(/ISO 8601/)
    expect(messages).toMatch(/between 1 and 5/)
    expect(messages).toMatch(/reviewCount or ratingCount/)
    expect(messages).toMatch(/Latitude/)
  })

  it("requires one of offers/aggregateRating/review for products", () => {
    const r = validateJsonLd({ "@context": "https://schema.org", "@type": "Product", name: "X" })
    expect(r.errors.some((e) => /at least one of offers/.test(e.message))).toBe(true)
  })

  it("maps list item errors to indexed paths", () => {
    const r = validateJsonLd(buildJsonLd("FAQPage", { mainEntity: [{ name: "Q1?", "acceptedAnswer.text": "A1" }, { name: "Q2?" }] }))
    expect(r.errors.map((e) => e.path)).toContain("mainEntity[1].acceptedAnswer.text")
  })

  it("applies subtype rules (BlogPosting → Article, Restaurant → LocalBusiness)", () => {
    const r = validateJsonLd({ "@context": "https://schema.org", "@type": "Restaurant", name: "X" })
    expect(r.errors.map((e) => e.path)).toContain("address")
    const blog = validateJsonLd({ "@context": "https://schema.org", "@type": "BlogPosting", headline: "x".repeat(120) })
    expect(blog.warnings.some((w) => /max 110/.test(w.message))).toBe(true)
  })

  it("accepts arrays of documents and reports unknown types as valid but not eligible", () => {
    const r = validateJsonLd([{ "@context": "https://schema.org", "@type": "Thing", name: "x" }])
    expect(r.valid).toBe(true)
    expect(r.richResultEligible).toBe(false)
  })

  it("flags script injection inside values", () => {
    const r = validateJsonLd({ "@context": "https://schema.org", "@type": "Thing", name: "<script>alert(1)</script>" })
    expect(r.valid).toBe(false)
  })

  it("resolves wildcard paths", () => {
    const m = resolvePath({ a: [{ b: 1 }, { b: 2 }] }, "a[].b")
    expect(m).toEqual([
      { path: "a[0].b", value: 1 },
      { path: "a[1].b", value: 2 },
    ])
  })
})

describe("HTML helpers", () => {
  it("escapes script-breaking characters", () => {
    const tag = toScriptTag({ name: "</script><script>alert(1)</script>" })
    expect(tag).not.toMatch(/<\/script><script>/)
    expect(tag.startsWith('<script type="application/ld+json" id="vss-structured-data">')).toBe(true)
    expect(JSON.parse(serializeJsonLd({ a: "<&>" }))).toEqual({ a: "<&>" })
  })

  it("extracts JSON-LD blocks from HTML", () => {
    const html = `<head>${toScriptTag({ "@type": "Thing" })}<script type='application/ld+json'>{bad</script></head>`
    const blocks = extractJsonLd(html)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.json).toEqual({ "@type": "Thing" })
    expect(blocks[1]!.error).toBeDefined()
  })

  it("builds a runtime injector for JS-only custom code slots", () => {
    const js = toInjectorScript({ "@type": "Thing", name: "</script>" })
    expect(js).not.toContain("</script>")
    // Execute against a minimal DOM shim
    const head: { children: Array<{ textContent: string }> } = { children: [] }
    const created: Array<{ textContent: string; type?: string; id?: string }> = []
    const document = {
      head: { appendChild: (el: { textContent: string }) => head.children.push(el) },
      getElementById: () => null,
      createElement: () => {
        const el = { textContent: "" }
        created.push(el)
        return el
      },
    }
    new Function("document", js)(document)
    expect(JSON.parse(head.children[0]!.textContent)).toEqual({ "@type": "Thing", name: "</script>" })
  })

  it("auto-detects FAQ pairs from content sections", () => {
    const pairs = extractFaqPairs([
      { heading: "How long does shipping take?", text: "Orders ship within two business days." },
      { heading: "Our story", text: "Founded in 2019 by two friends." },
      { heading: "Can I return items", text: "Yes, within thirty days of delivery." },
    ])
    expect(pairs).toEqual([
      { name: "How long does shipping take?", "acceptedAnswer.text": "Orders ship within two business days." },
      { name: "Can I return items?", "acceptedAnswer.text": "Yes, within thirty days of delivery." },
    ])
  })

  it("sanitizes FAQ answer HTML", () => {
    expect(sanitizeAnswerHtml('<p onclick="x()">Hi <img src=x><a href="javascript:alert(1)">l</a><script>bad()</script></p>')).toBe(
      '<p>Hi <a href="#">l</a></p>',
    )
  })
})
