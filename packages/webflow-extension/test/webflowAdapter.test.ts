import { describe, expect, it } from "vitest"
import { SCHEMA_DEFINITIONS, auditAccessibility, buildJsonLd, memoryStore, validateJsonLd } from "@vss/core-engine"
import { createWebflowAdapter, type WebflowDesignerApi } from "../src/webflowAdapter.ts"
import { createFakeDataApi, createFakeWebflow, type FakeElement } from "../src/testing/fakeWebflow.ts"

function setup(opts: { token?: string | null } = {}) {
  const fake = createFakeWebflow()
  const api = createFakeDataApi({ limitPerWindow: 1000 })
  const deviceStorage = memoryStore(opts.token === null ? {} : { "vss:webflow-token": opts.token ?? "test-token" })
  const copied: string[] = []
  const adapter = createWebflowAdapter(fake as unknown as WebflowDesignerApi, {
    deviceStorage,
    fetch: api.fetch,
    clipboard: async (t) => {
      copied.push(t)
      return true
    },
  })
  return { fake, api, adapter, copied, el: (id: string) => fake.state.elements.find((e) => e.id.element === id) as FakeElement }
}

describe("webflow.json manifest", () => {
  it("targets Designer API v2 and bundles dist/", async () => {
    const manifest = (await import("../webflow.json", { with: { type: "json" } })).default as Record<string, unknown>
    expect(manifest).toMatchObject({ name: "Visual SEO & Schema Suite", apiVersion: "2", publicDir: "dist" })
    expect(["default", "comfortable", "large"]).toContain(manifest.size)
  })
})

describe("createWebflowAdapter — Designer API", () => {
  it("derives the user id from webflow.getIdToken()", async () => {
    const { adapter } = setup()
    expect(await adapter.getUser()).toEqual({ id: "wf-user-42" })
  })

  it("falls back to the site id when the id token is unavailable", async () => {
    const { adapter, fake } = setup()
    fake.state.idToken = "garbage"
    expect(await adapter.getUser()).toEqual({ id: "site:site-123" })
  })

  it("lists images in the selection via webflow.getSelectedElement() and descendants", async () => {
    const { adapter } = setup()
    const images = await adapter.listImages("selection")
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ id: "el:page:img-hero", alt: null, filename: "64f0c0ffee12345678901234_mountain-cabin-at-sunrise.jpg", name: "Hero image" })
  })

  it("lists page images and site-wide image assets (skipping non-images)", async () => {
    const { adapter } = setup()
    expect((await adapter.listImages("page")).map((i) => i.id)).toEqual(["el:page:img-hero", "el:page:img-logo"])
    const assets = await adapter.listImages("project")
    expect(assets.map((a) => a.id).sort()).toEqual(["asset:as-hero", "asset:as-logo"])
  })

  it("writes alt text to elements and assets", async () => {
    const { adapter, fake, el } = setup()
    const res = await adapter.applyAltText([
      { id: "el:page:img-hero", alt: "Mountain cabin at sunrise" },
      { id: "asset:as-logo", alt: "Acme logo" },
      { id: "el:page:nope", alt: "x" },
    ])
    expect(res.updated).toBe(2)
    expect(res.failed).toHaveLength(1)
    expect(el("img-hero").alt).toBe("Mountain cabin at sunrise")
    expect(fake.state.assets.find((a) => a.id === "as-logo")!.alt).toBe("Acme logo")
  })

  it("reads page content and writes SEO title/description", async () => {
    const { adapter, fake } = setup()
    const page = await adapter.getPageInfo()
    expect(page).toMatchObject({ title: "Acme Cabins", url: "https://acme-cabins.com/", brand: "Acme Cabins" })
    expect(page.headings).toEqual(["Cabins in the mountains", "Do you allow pets?"])
    expect(page.sections?.[1]?.text).toContain("two of our cabins")
    await adapter.setPageMeta!({ title: "Mountain Cabins | Acme", description: "Quiet cabins with views." })
    expect(fake.state.page).toMatchObject({ title: "Mountain Cabins | Acme", description: "Quiet cabins with views." })
  })

  it("collects audit nodes from element styles and fixes via custom attributes", async () => {
    const { adapter, el } = setup()
    const { nodes, page } = await adapter.collectAuditNodes("page")
    expect(page?.description).toBe("")
    const report = auditAccessibility({ nodes, page })
    const rules = report.issues.map((i) => `${i.rule}:${i.nodeId ?? ""}`)
    expect(rules).toContain("text-contrast:el:page:p1")
    expect(rules).toContain("image-alt:el:page:img-hero")
    expect(rules).toContain("generic-link-text:el:page:link-more")
    expect(rules).toContain("link-name:el:page:btn-icon")
    expect(rules).toContain("heading-order:el:page:h3")

    const nameIssue = report.issues.find((i) => i.rule === "link-name")!
    expect(await adapter.applyAuditFix!(nameIssue)).toBe(true)
    expect(el("btn-icon").customAttrs["aria-label"]).toBe("Cart button")
    const altIssue = report.issues.find((i) => i.rule === "image-alt" && i.nodeId === "el:page:img-hero")!
    expect(await adapter.applyAuditFix!(altIssue)).toBe(true)
    expect(el("img-hero").alt).toBe("Mountain cabin at sunrise")
    const colorIssue = report.issues.find((i) => i.rule === "text-contrast")!
    expect(await adapter.applyAuditFix!(colorIssue)).toBe(false)
  })

  it("adds page JSON-LD as a <script type=application/ld+json> DOM element and updates it in place", async () => {
    const { adapter, fake } = setup()
    const faq = buildJsonLd("FAQPage", SCHEMA_DEFINITIONS.FAQPage.example)
    const res = await adapter.saveStructuredData([faq], "page")
    expect(res.method).toBe("webflow DOM element")
    const scripts = fake.state.elements.filter((e) => e.type === "DOM" && !e.removed)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]!.tag).toBe("script")
    expect(scripts[0]!.attributes).toEqual({ id: "vss-structured-data", type: "application/ld+json" })
    expect(validateJsonLd(JSON.parse(scripts[0]!.content!)).valid).toBe(true)

    const article = buildJsonLd("Article", SCHEMA_DEFINITIONS.Article.example)
    await adapter.saveStructuredData([faq, article], "page")
    expect(fake.state.elements.filter((e) => e.type === "DOM" && !e.removed)).toHaveLength(1)
    expect(JSON.parse(scripts[0]!.content!)["@graph"]).toHaveLength(2)
    expect(await adapter.getStructuredData("page")).toHaveLength(2)

    await adapter.saveStructuredData([], "page")
    expect(fake.state.elements.filter((e) => e.type === "DOM" && !e.removed)).toHaveLength(0)
  })

  it("falls back to clipboard for site-wide head code when the token lacks custom_code scope", async () => {
    const { adapter, copied, api } = setup()
    const biz = buildJsonLd("LocalBusiness", SCHEMA_DEFINITIONS.LocalBusiness.example)
    const res = await adapter.saveStructuredData([biz], "site")
    expect(api.calls.some((c) => c.path.endsWith("registered_scripts/inline") && c.status === 403)).toBe(true)
    expect(res.method).toBe("clipboard")
    expect(res.message).toContain("Site settings › Custom code › Head code")
    expect(copied[0]).toContain("application/ld+json")
  })

  it("maps webflow.notify types", () => {
    const { adapter, fake } = setup()
    adapter.notify("Saved", "success")
    adapter.notify("Oops", "error")
    expect(fake.state.notifications).toEqual([
      { type: "Success", message: "Saved" },
      { type: "Error", message: "Oops" },
    ])
  })
})

describe("createWebflowAdapter — CMS via Data API v2", () => {
  it("requires a token before calling the Data API", async () => {
    const { adapter } = setup({ token: null })
    await expect(adapter.listCollections!()).rejects.toThrow(/site API token/)
  })

  it("lists collections with field types keyed by slug", async () => {
    const { adapter } = setup()
    const [col] = await adapter.listCollections!()
    expect(col!.name).toBe("Cabins")
    expect(col!.fields.map((f) => `${f.id}:${f.type}`)).toEqual(["name:text", "main-image:image", "seo-description:text", "body:richtext"])
  })

  it("reads items and bulk-updates image alt + text fields in throttled batches", async () => {
    const { adapter, api } = setup()
    const items = await adapter.listCollectionItems!("col-1")
    expect(items).toHaveLength(250)
    expect(items[0]!.fieldData["main-image"]).toEqual({ url: expect.stringContaining("cabin-1-exterior"), alt: null })
    const updates = items.flatMap((i) => [
      { itemId: i.id, fieldId: "main-image", kind: "image-alt" as const, value: `${i.title} exterior` },
      { itemId: i.id, fieldId: "seo-description", kind: "text" as const, value: `${i.title}: lakeside cabin for four.` },
    ])
    const progress: number[] = []
    const res = await adapter.updateCollectionItems!("col-1", updates, (d) => progress.push(d))
    expect(res.failed).toEqual([])
    expect(res.updated).toBe(250)
    expect(progress.at(-1)).toBe(250)
    const first = api.items[0]!.fieldData
    expect(first["main-image"]).toEqual({ fileId: "file-1", url: expect.any(String), alt: "Cabin 1 exterior" })
    expect(first["seo-description"]).toBe("Cabin 1: lakeside cabin for four.")
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(3)
  })

  it("reports per-item validation failures without failing the batch", async () => {
    const { adapter } = setup()
    const res = await adapter.updateCollectionItems!("col-1", [
      { itemId: "item-1", fieldId: "seo-description", kind: "text", value: "ok" },
      { itemId: "item-2", fieldId: "seo-description", kind: "text", value: "x".repeat(600) },
    ])
    expect(res.updated).toBe(1)
    expect(res.failed).toEqual([{ id: "item-2", error: expect.stringContaining("Validation Error") }])
  })
})
