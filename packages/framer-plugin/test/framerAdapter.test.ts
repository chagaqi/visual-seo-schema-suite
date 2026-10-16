import { describe, expect, it } from "vitest"
import { auditAccessibility, memoryStore, validateJsonLd, buildJsonLd, SCHEMA_DEFINITIONS, extractJsonLd } from "@vss/core-engine"
import { createFramerAdapter, type FramerApi } from "../src/framerAdapter.ts"
import { createFakeFramer, type FakeImageAsset } from "../src/testing/fakeFramer.ts"

function setup() {
  const fake = createFakeFramer()
  const copied: string[] = []
  const adapter = createFramerAdapter(fake as unknown as FramerApi, {
    deviceStorage: memoryStore(),
    clipboard: async (t) => {
      copied.push(t)
      return true
    },
  })
  return { fake, adapter, copied }
}

describe("framer.json manifest", () => {
  it("is valid for the Framer marketplace", async () => {
    const manifest = (await import("../framer.json", { with: { type: "json" } })).default as Record<string, unknown>
    expect(manifest.id).toMatch(/^[0-9a-f]{6}$/)
    expect(manifest.name).toBe("Visual SEO & Schema Suite")
    expect(manifest.modes).toContain("canvas")
    expect(manifest.icon).toBe("/icon.svg")
  })
})

describe("createFramerAdapter", () => {
  it("identifies the current user via framer.getCurrentUser()", async () => {
    const { adapter } = setup()
    expect(await adapter.getUser()).toEqual({ id: "user-hash-123", name: "Ada Designer" })
  })

  it("lists images from framer.getSelection() including descendants, with caption context", async () => {
    const { adapter } = setup()
    const images = await adapter.listImages("selection")
    expect(images.map((i) => i.id)).toEqual(["hero-img"])
    expect(images[0]).toMatchObject({ name: "Barista pouring latte art", alt: null, width: 800, height: 500, nearbyText: "Specialty coffee, roasted daily" })
  })

  it("lists page and project images", async () => {
    const { adapter } = setup()
    expect((await adapter.listImages("page")).map((i) => i.id).sort()).toEqual(["g-img", "hero-img", "logo"])
    expect(await adapter.listImages("project")).toHaveLength(3)
  })

  it("applies alt text by cloning the immutable ImageAsset and marks nodes via setPluginData", async () => {
    const { adapter, fake } = setup()
    const res = await adapter.applyAltText([
      { id: "hero-img", alt: "Barista pouring latte art" },
      { id: "logo", alt: "", decorative: true },
      { id: "missing", alt: "x" },
    ])
    expect(res.updated).toBe(2)
    expect(res.failed).toEqual([{ id: "missing", error: "Layer no longer has an image" }])
    const hero = fake.state.nodes.get("hero-img")!
    expect((hero.backgroundImage as FakeImageAsset).altText).toBe("Barista pouring latte art")
    expect(hero.pluginData.get("vss:alt")).toBe("generated")
    expect(fake.state.nodes.get("logo")!.pluginData.get("vss:alt")).toBe("decorative")
    expect(fake.state.setAttributeCalls[0]!.attributes).toHaveProperty("backgroundImage")
  })

  it("persists settings with framer.setPluginData()", async () => {
    const { adapter, fake } = setup()
    await adapter.projectStorage.set("vss:settings", '{"brand":"Blue Door"}')
    expect(fake.state.pluginData.get("vss:settings")).toBe('{"brand":"Blue Door"}')
    expect(await adapter.projectStorage.get("vss:settings")).toBe('{"brand":"Blue Door"}')
  })

  it("extracts page content with headings, sections and brand", async () => {
    const { adapter } = setup()
    const page = await adapter.getPageInfo()
    expect(page.headings).toEqual(["Specialty coffee, roasted daily", "Do you ship internationally?"])
    expect(page.brand).toBe("Blue Door Coffee")
    expect(page.sections?.[1]).toEqual({ heading: "Do you ship internationally?", text: "Yes, we ship to over forty countries and calculate duties at checkout." })
  })

  it("collects audit nodes with effective backgrounds and finds contrast issues", async () => {
    const { adapter } = setup()
    const { nodes } = await adapter.collectAuditNodes("page")
    const sub = nodes.find((n) => n.id === "hero-sub")
    expect(sub).toMatchObject({ kind: "text", color: "#444444", background: "#111111", fontSizePx: 16 })
    const report = auditAccessibility({ nodes })
    expect(report.issues.some((i) => i.nodeId === "hero-sub" && i.rule === "text-contrast")).toBe(true)
    expect(report.issues.some((i) => i.nodeId === "hero-img" && i.rule === "image-alt")).toBe(true)
  })

  it("applies alt fixes from the audit but refuses shared text-style color changes", async () => {
    const { adapter } = setup()
    expect(await adapter.applyAuditFix!({ id: "1", rule: "image-alt", criterion: "1.1.1", level: "A", severity: "serious", message: "", nodeId: "g-img", fix: { type: "alt", value: "Roastery", decorative: false } })).toBe(true)
    expect(await adapter.applyAuditFix!({ id: "2", rule: "text-contrast", criterion: "1.4.3", level: "AA", severity: "serious", message: "", nodeId: "hero-sub", fix: { type: "color", property: "color", value: "#888", ratio: 5 } })).toBe(false)
  })

  it("lists user collections and plugin-managed collections (framer.getManagedCollections())", async () => {
    const { adapter } = setup()
    const collections = await adapter.listCollections!()
    expect(collections.map((c) => [c.name, c.readOnly])).toEqual([
      ["Blog", false],
      ["Synced products (managed)", true],
    ])
    expect(collections[0]!.fields.map((f) => f.type)).toEqual(["text", "image", "text", "richtext"])
  })

  it("reads and bulk-updates CMS items (text + image alt)", async () => {
    const { adapter, fake } = setup()
    const items = await adapter.listCollectionItems!("col-blog")
    expect(items[0]).toMatchObject({ id: "item-1", title: "The complete pour-over guide" })
    expect(items[0]!.fieldData.cover).toEqual({ url: "https://framerusercontent.com/images/Qa71Kq0LmP2nB5vC7xQ.jpg", alt: null })
    const progress: number[] = []
    const res = await adapter.updateCollectionItems!(
      "col-blog",
      [
        { itemId: "item-1", fieldId: "meta", kind: "text", value: "Master pour-over coffee at home." },
        { itemId: "item-2", fieldId: "cover", kind: "image-alt", value: "Espresso shot pouring" },
        { itemId: "nope", fieldId: "meta", kind: "text", value: "x" },
      ],
      (d) => progress.push(d),
    )
    expect(res.updated).toBe(2)
    expect(progress).toEqual([1, 2, 3])
    const blog = fake.state.collections[0]!
    expect(blog.items[0]!.fieldData.meta!.value).toBe("Master pour-over coffee at home.")
    expect((blog.items[1]!.fieldData.cover!.value as FakeImageAsset).altText).toBe("Espresso shot pouring")
  })

  it("honours cancellation during CMS updates", async () => {
    const { adapter } = setup()
    const controller = new AbortController()
    controller.abort()
    const res = await adapter.updateCollectionItems!("col-blog", [{ itemId: "item-1", fieldId: "meta", kind: "text", value: "x" }], undefined, controller.signal)
    expect(res.failed[0]!.error).toBe("Cancelled")
  })

  it("injects site-wide JSON-LD into the head with framer.setCustomCode()", async () => {
    const { adapter, fake } = setup()
    const business = buildJsonLd("LocalBusiness", SCHEMA_DEFINITIONS.LocalBusiness.example)
    const app = buildJsonLd("SoftwareApplication", SCHEMA_DEFINITIONS.SoftwareApplication.example)
    const res = await adapter.saveStructuredData([business, app], "site")
    expect(res.method).toBe("framer.setCustomCode(headEnd)")
    const html = fake.state.customCode.headEnd!
    const blocks = extractJsonLd(html)
    expect(blocks).toHaveLength(1)
    expect(validateJsonLd(blocks[0]!.json!).valid).toBe(true)
    expect((blocks[0]!.json as { "@graph": unknown[] })["@graph"]).toHaveLength(2)
    expect(await adapter.getStructuredData("site")).toHaveLength(2)
    await adapter.saveStructuredData([], "site")
    expect(fake.state.customCode.headEnd).toBeNull()
  })

  it("stores page-level schema per page and copies the script tag", async () => {
    const { adapter, copied } = setup()
    const faq = buildJsonLd("FAQPage", SCHEMA_DEFINITIONS.FAQPage.example)
    const res = await adapter.saveStructuredData([faq], "page")
    expect(res.method).toBe("clipboard")
    expect(copied[0]).toContain('type="application/ld+json"')
    expect(await adapter.getStructuredData("page")).toEqual([faq])
    expect(await adapter.getStructuredData("site")).toEqual([])
  })

  it("reads the selected SVG and inserts optimized SVGs with framer.addSVG()", async () => {
    const { adapter, fake } = setup()
    expect(await adapter.getSelectedSvg!()).toBeNull()
    fake.state.selection = ["icon"]
    const sel = await adapter.getSelectedSvg!()
    expect(sel?.name).toBe("Cup icon")
    await adapter.insertSvg!("<svg/>", "icon.svg")
    expect(fake.state.addedSvgs).toEqual([{ svg: "<svg/>", name: "icon.svg" }])
  })

  it("truncates notifications to Framer's 120 character limit", () => {
    const { adapter, fake } = setup()
    adapter.notify("x".repeat(200), "success")
    expect(fake.state.notifications[0]).toEqual({ message: "x".repeat(120), variant: "success" })
  })
})
