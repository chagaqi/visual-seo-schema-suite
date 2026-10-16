import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildAltPrompt,
  cleanAiAlt,
  describeImageWithAi,
  generateAltText,
  generateBulkAltText,
  isDefaultLayerName,
  lintAltText,
  looksRandom,
  parseImageFilename,
  setAnthropicClientFactory,
  type AnthropicClientLike,
} from "../src/index.ts"

describe("parseImageFilename", () => {
  it("strips Webflow CDN ids, responsive suffixes and retina markers", () => {
    const p = parseImageFilename(
      "https://cdn.prod.website-files.com/64f0c0ffee/6512a7b3c9d4e5f6a7b8c9d0_team-photo_SanFrancisco-office@2x-p-1080.jpeg",
    )
    expect(p.extension).toBe("jpeg")
    expect(p.tokens).toEqual(["team", "san", "francisco", "office"])
    expect(p.informative).toBe(true)
  })

  it("treats Framer CDN hashes as uninformative", () => {
    const p = parseImageFilename("https://framerusercontent.com/images/aBc9XyZ12qWeRtY7uIoP.jpg?scale-down-to=512")
    expect(p.informative).toBe(false)
    expect(p.tokens).toEqual([])
  })

  it("recognises camera, screenshot and stock filenames as machine generated", () => {
    expect(parseImageFilename("IMG_20230412_101500.jpg").machineGenerated).toBe(true)
    expect(parseImageFilename("DSC_0042.JPG").machineGenerated).toBe(true)
    expect(parseImageFilename("PXL_20240101_123456789.jpg").machineGenerated).toBe(true)
    const shot = parseImageFilename("Screenshot 2024-05-01 at 10.22.11.png")
    expect(shot.machineGenerated).toBe(true)
    expect(shot.kinds).toContain("screenshot")
    expect(parseImageFilename("john-doe-AbCdEfGhIjK-unsplash.jpg").informative).toBe(false)
  })

  it("drops version noise and detects kinds", () => {
    const p = parseImageFilename("acme-logo-v3-final-FINAL.svg")
    expect(p.tokens).toEqual(["acme"])
    expect(p.kinds).toContain("logo")
  })

  it("splits camelCase, expands abbreviations and keeps acronyms", () => {
    const p = parseImageFilename("pricingPageCTA_btn.png")
    expect(p.tokens).toEqual(["pricing", "page", "call to action", "button"])
    expect(parseImageFilename("SEOAuditDashboard.png").tokens).toEqual(["SEO", "audit", "dashboard"])
  })

  it("flags pure decoration", () => {
    expect(parseImageFilename("hero-bg-pattern.png").kinds).toContain("decorative")
    // Real content wins over the "background" hint.
    expect(parseImageFilename("background-mountain-lake-sunrise.jpg").kinds).not.toContain("decorative")
  })

  it("detects random tokens", () => {
    expect(looksRandom("a8f3c2d1e9b0")).toBe(true)
    expect(looksRandom("Xk29PqLm77Zt")).toBe(true)
    expect(looksRandom("mountain")).toBe(false)
    expect(looksRandom("office")).toBe(false)
  })

  it("recognises default layer names", () => {
    expect(isDefaultLayerName("Image")).toBe(true)
    expect(isDefaultLayerName("Frame 12")).toBe(true)
    expect(isDefaultLayerName("Div Block 3")).toBe(true)
    expect(isDefaultLayerName("Founder headshot")).toBe(false)
  })
})

describe("lintAltText", () => {
  it("errors on missing, placeholder and filename alts", () => {
    expect(lintAltText("").map((i) => i.code)).toEqual(["missing"])
    expect(lintAltText("", { decorative: true })).toEqual([])
    expect(lintAltText("image").map((i) => i.code)).toContain("placeholder")
    expect(lintAltText("IMG_1234.jpg").map((i) => i.code)).toContain("filename")
  })

  it("warns on redundant prefixes, length, caps and duplicate captions", () => {
    expect(lintAltText("Image of a red bicycle").map((i) => i.code)).toContain("redundant-prefix")
    expect(lintAltText("x".repeat(130)).map((i) => i.code)).toContain("too-long")
    expect(lintAltText("BIG SUMMER SALE BANNER").map((i) => i.code)).toContain("all-caps")
    expect(lintAltText("Click here to buy").map((i) => i.code)).toContain("click-here")
    expect(lintAltText("Our team", { nearbyText: "Our team" }).map((i) => i.code)).toContain("duplicate-of-caption")
  })

  it("passes good alt text", () => {
    expect(lintAltText("Barista pouring latte art into a ceramic cup")).toEqual([])
  })
})

describe("generateAltText", () => {
  it("is deterministic", () => {
    const ctx = { src: "https://x.test/red-bicycle-against-brick-wall.jpg" }
    expect(generateAltText(ctx)).toEqual(generateAltText(ctx))
  })

  it("builds alt text from an informative filename", () => {
    const r = generateAltText({ src: "https://x.test/uploads/red-bicycle-against-brick-wall-1920x1080.jpg" })
    expect(r.alt).toBe("Red bicycle against brick wall")
    expect(r.source).toBe("filename")
    expect(r.decorative).toBe(false)
  })

  it("prefers a meaningful layer name and boosts agreement", () => {
    const r = generateAltText({ src: "https://x.test/founder.jpg", layerName: "Founder Maya Chen speaking at conference" })
    expect(r.alt).toBe("Founder Maya Chen speaking at conference")
    expect(r.source).toBe("layer")
    expect(r.confidence).toBeGreaterThan(0.7)
  })

  it("uses the CMS item title for collection images", () => {
    const r = generateAltText({ src: "https://framerusercontent.com/images/Zx81Kq0LmP2nB5vC7xQ.png", collectionItemTitle: "Ten Minute Weeknight Ramen" })
    expect(r.alt).toBe("Ten Minute Weeknight Ramen")
    expect(r.source).toBe("collection")
  })

  it("shapes logos, icons, portraits, screenshots and charts", () => {
    expect(generateAltText({ src: "/acme-logo.svg" }).alt).toBe("Acme logo")
    expect(generateAltText({ src: "/logo.svg", brand: "Blue Door" }).alt).toBe("Blue Door logo")
    expect(generateAltText({ src: "/shopping-cart-icon.svg" }).alt).toBe("Shopping cart icon")
    expect(generateAltText({ src: "/headshot-maya-chen.jpg" }).alt).toBe("Portrait of Maya Chen")
    expect(generateAltText({ src: "/screenshot-analytics-dashboard.png" }).alt).toBe("Screenshot of analytics dashboard")
    expect(generateAltText({ src: "/chart-monthly-revenue-growth.png" }).alt).toBe("Chart showing monthly revenue growth")
  })

  it("marks decorative images with empty alt", () => {
    const r = generateAltText({ src: "/section-divider-squiggle.svg" })
    expect(r.decorative).toBe(true)
    expect(r.alt).toBe("")
    expect(generateAltText({ src: "/x.png", width: 1, height: 400 }).decorative).toBe(true)
  })

  it("keeps good existing alt text unless overwrite is set", () => {
    const ctx = { src: "/sunset.jpg", existingAlt: "Sunset over the Golden Gate Bridge" }
    expect(generateAltText(ctx).source).toBe("existing")
    expect(generateAltText(ctx, { overwrite: true }).source).not.toBe("existing")
    // Bad existing alt is replaced
    expect(generateAltText({ src: "/sunset-beach.jpg", existingAlt: "IMG_2231.JPG" }).alt).toBe("Sunset beach")
  })

  it("describes linked images by destination when nothing else is known", () => {
    const r = generateAltText({ src: "https://framerusercontent.com/images/Zx81Kq0LmP2nB5vC7xQ.png", linkHref: "/pricing-plans" })
    expect(r.alt).toBe("Pricing plans")
  })

  it("falls back to keyword then page title, flagging review", () => {
    const k = generateAltText({ src: "https://framerusercontent.com/images/Zx81Kq0LmP2nB5vC7xQ.png", keywords: ["espresso machine"] })
    expect(k.alt).toBe("Espresso machine")
    expect(k.needsReview).toBe(true)
    const p = generateAltText({ src: "https://framerusercontent.com/images/Zx81Kq0LmP2nB5vC7xQ.png", pageTitle: "Pricing | Acme" })
    expect(p.alt).toBe("Pricing")
    expect(p.needsReview).toBe(true)
  })

  it("returns an empty, review-flagged result when nothing is known", () => {
    const r = generateAltText({ src: "https://framerusercontent.com/images/Zx81Kq0LmP2nB5vC7xQ.png" })
    expect(r.alt).toBe("")
    expect(r.source).toBe("fallback")
    expect(r.needsReview).toBe(true)
  })

  it("enforces max length and strips redundant prefixes", () => {
    const r = generateAltText({ layerName: `Image of ${"very long descriptive words ".repeat(10)}` }, { maxLength: 60 })
    expect(r.alt.length).toBeLessThanOrEqual(60)
    expect(r.alt.startsWith("Image of")).toBe(false)
  })
})

describe("AI describers (BYO key)", () => {
  afterEach(() => setAnthropicClientFactory(null))

  it("builds a context-rich prompt", () => {
    const prompt = buildAltPrompt({ pageTitle: "Menu", nearbyText: "Seasonal pastries", filename: "croissant.jpg" })
    expect(prompt).toContain("Page title: Menu")
    expect(prompt).toContain("Nearby text: Seasonal pastries")
    expect(prompt).toContain("DECORATIVE")
  })

  it("cleans model output", () => {
    expect(cleanAiAlt('"Image of a golden croissant on a plate."')).toBe("A golden croissant on a plate")
    expect(cleanAiAlt("Alt text: smiling barista")).toBe("Smiling barista")
  })

  it("calls Anthropic with an image URL block, low effort and default fallbacks", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "Golden croissant on a marble counter" }] })
    setAnthropicClientFactory(async () => ({ beta: { messages: { create } } }) as unknown as AnthropicClientLike)
    const r = await describeImageWithAi({ src: "https://cdn.test/a.jpg" }, { provider: "anthropic", apiKey: "sk-test" })
    expect(r).toEqual({ alt: "Golden croissant on a marble counter", decorative: false })
    const params = create.mock.calls[0]![0]
    expect(params.model).toBe("claude-opus-5-5")
    expect(params.output_config).toEqual({ effort: "low" })
    expect(params.fallbacks).toBe("default")
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"])
    expect(params.messages[0].content[0]).toEqual({ type: "image", source: { type: "url", url: "https://cdn.test/a.jpg" } })
  })

  it("throws on Anthropic refusal so callers fall back", async () => {
    setAnthropicClientFactory(async () => ({ beta: { messages: { create: vi.fn().mockResolvedValue({ stop_reason: "refusal", content: [] }) } } }) as unknown as AnthropicClientLike)
    await expect(describeImageWithAi({ src: "https://cdn.test/a.jpg" }, { provider: "anthropic", apiKey: "k" })).rejects.toThrow(/declined/)
  })

  it("calls OpenAI chat completions and detects decorative", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "DECORATIVE" } }] }), { status: 200 }))
    const r = await describeImageWithAi({ src: "https://cdn.test/a.jpg" }, { provider: "openai", apiKey: "sk", fetch: fetchMock })
    expect(r.decorative).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://api.openai.com/v1/chat/completions")
    expect(JSON.parse(init.body).messages[0].content[1].image_url.url).toBe("https://cdn.test/a.jpg")
  })

  it("rejects non-public image URLs", async () => {
    await expect(describeImageWithAi({ src: "data:image/png;base64,xx" }, { provider: "openai", apiKey: "k" })).rejects.toThrow(/public image URL/)
  })
})

describe("generateBulkAltText", () => {
  afterEach(() => setAnthropicClientFactory(null))

  it("processes items with progress, caching duplicates", async () => {
    const progress: number[] = []
    const items = [
      { id: "1", context: { src: "/red-bicycle.jpg" } },
      { id: "2", context: { src: "/red-bicycle.jpg" } },
      { id: "3", context: { src: "/acme-logo.svg" } },
    ]
    const res = await generateBulkAltText(items, { onProgress: (d) => progress.push(d) })
    expect(res.map((r) => r.id)).toEqual(["1", "2", "3"])
    expect(res[0]!.alt).toBe(res[1]!.alt)
    expect(progress).toEqual([1, 2, 3])
  })

  it("only sends low-confidence items to AI and falls back on errors", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "Hand-drawn map of the venue" }] })
      .mockRejectedValueOnce(new Error("rate limited"))
    setAnthropicClientFactory(async () => ({ beta: { messages: { create } } }) as unknown as AnthropicClientLike)
    const items = [
      { id: "good", context: { src: "https://cdn.test/red-bicycle-against-brick-wall.jpg" } },
      { id: "weak", context: { src: "https://framerusercontent.com/images/Zx81Kq0LmP2nB5vC7xQ.png" } },
      { id: "weak2", context: { src: "https://framerusercontent.com/images/Qa71Kq0LmP2nB5vC7xQ.png" } },
    ]
    const res = await generateBulkAltText(items, { ai: { provider: "anthropic", apiKey: "k" }, concurrency: 1 })
    expect(create).toHaveBeenCalledTimes(2)
    expect(res[0]!.source).toBe("filename")
    expect(res[1]!.source).toBe("ai")
    expect(res[1]!.alt).toBe("Hand-drawn map of the venue")
    expect(res[2]!.source).toBe("fallback")
    expect(res[2]!.error).toBe("rate limited")
  })
})
