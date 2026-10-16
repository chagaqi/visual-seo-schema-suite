import { expect, test } from "@playwright/test"
import { createFakeDataApi } from "../packages/webflow-extension/src/testing/fakeWebflow.ts"
import { WEBFLOW_URL, axeViolations, mockLicense } from "./helpers.ts"

type FakeWebflowWindow = Window & {
  __VSS_FAKE_WEBFLOW__: {
    state: {
      elements: Array<{ id: { element: string }; type: string; alt: string | null; customAttrs: Record<string, string>; tag: string | null; content: string | null; removed: boolean }>
      page: { title: string; description: string }
      notifications: Array<{ type: string; message: string }>
    }
  }
}

// Mirrors the license worker's CORS config: without this the browser hides Retry-After from JS.
const EXPOSE = { "access-control-expose-headers": "retry-after, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset" }

const state = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = (window as unknown as FakeWebflowWindow).__VSS_FAKE_WEBFLOW__.state
    const elements = s.elements.map((e) => ({ id: e.id, type: e.type, alt: e.alt, customAttrs: e.customAttrs, tag: e.tag, content: e.content, removed: e.removed }))
    return JSON.parse(JSON.stringify({ elements, page: s.page, notifications: s.notifications })) as FakeWebflowWindow["__VSS_FAKE_WEBFLOW__"]["state"]
  })

test.describe("Webflow Designer Extension (headless, fake Designer API)", () => {
  test.beforeEach(async ({ page }) => {
    await mockLicense(page)
    await page.goto(WEBFLOW_URL)
    await expect(page.getByRole("tab", { name: "Alt text" })).toBeVisible()
  })

  test("renders Webflow Designer tokens and passes axe WCAG AA", async ({ page }) => {
    await expect(page.locator(".vss-root")).toHaveAttribute("data-vss-host", "webflow")
    await expect(page.locator(".vss-root")).toHaveCSS("background-color", "rgb(30, 30, 30)")
    expect(await axeViolations(page)).toEqual([])
  })

  test("alt text for the selected element (webflow.getSelectedElement) is written with setAltText", async ({ page }) => {
    await page.getByRole("button", { name: "Scan" }).click()
    await page.getByTestId("generate-alt").click()
    await expect(page.getByLabel("Alt text for Hero image")).toHaveValue("Mountain cabin at sunrise")
    await page.getByTestId("apply-alt").click()
    await expect.poll(async () => (await state(page)).elements.find((e) => e.id.element === "img-hero")!.alt).toBe("Mountain cabin at sunrise")
    expect((await state(page)).notifications.at(-1)).toEqual({ type: "Success", message: "Updated 1 image." })
  })

  test("meta: generates and saves page title + description through the Pages API", async ({ page }) => {
    await page.getByRole("tab", { name: "Meta" }).click()
    await expect(page.getByText(/Analysing “Acme Cabins”/)).toBeVisible()
    await page.getByTestId("generate-meta").click()
    const desc = page.getByTestId("meta-description")
    await expect(desc).not.toHaveValue("")
    await page.getByTestId("apply-meta").click()
    const value = await desc.inputValue()
    await expect.poll(async () => (await state(page)).page.description).toBe(value)
    expect(value.length).toBeLessThanOrEqual(155)
  })

  test("audit: applies an aria-label fix as a custom attribute", async ({ page }) => {
    await page.getByRole("tab", { name: "Contrast & A11y" }).click()
    await page.getByTestId("run-audit").click()
    const issue = page.getByTestId("audit-issue").filter({ hasText: "has no accessible name" })
    await issue.getByRole("button", { name: "Apply fix" }).click()
    await expect(issue.getByRole("button", { name: "Fixed" })).toBeVisible()
    expect((await state(page)).elements.find((e) => e.id.element === "btn-icon")!.customAttrs["aria-label"]).toBe("Cart button")
  })

  test("schema: FAQ imported from page headings becomes a <script type=application/ld+json> element", async ({ page }) => {
    await page.getByRole("tab", { name: "Schema" }).click()
    await page.getByTestId("schema-type-FAQPage").click()
    await page.getByRole("button", { name: "Import from page" }).click()
    await expect(page.getByTestId("list-item-mainEntity")).toHaveCount(1)
    await page.getByTestId("save-schema").click()
    await expect(page.getByText("JSON-LD added to this page. Publish to go live.").first()).toBeVisible()
    const dom = (await state(page)).elements.find((e) => e.type === "DOM" && !e.removed)!
    expect(dom.tag).toBe("script")
    expect(JSON.parse(dom.content!)).toMatchObject({ "@type": "FAQPage", mainEntity: [{ name: "Do you allow pets?" }] })
  })

  test("CMS: throttled bulk alt text over 250 items survives an HTTP 429 with Retry-After", async ({ page }) => {
    test.setTimeout(90_000)
    const api = createFakeDataApi({ limitPerWindow: 10_000 })
    let injected = false
    await page.route("https://license.test/v1/webflow/**", async (route) => {
      const req = route.request()
      const target = req.url().replace("https://license.test/v1/webflow", "https://api.webflow.com/v2")
      if (req.method() === "PATCH" && !injected) {
        injected = true
        return route.fulfill({ status: 429, headers: { ...EXPOSE, "retry-after": "1", "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0" }, json: { message: "Too many requests" } })
      }
      const res = await api.fetch(target, { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined })
      return route.fulfill({ status: res.status, headers: { ...Object.fromEntries(res.headers.entries()), ...EXPOSE }, body: await res.text() })
    })

    await page.getByRole("tab", { name: "Settings" }).click()
    await page.getByLabel("Webflow site API token").fill("test-token")
    await page.getByRole("button", { name: "Save connection" }).click()

    await page.getByRole("tab", { name: "CMS" }).click()
    await page.getByTestId("load-collections").click()
    await page.getByLabel("Collection").selectOption({ label: "Cabins" })
    await expect(page.getByText("250 items loaded.")).toBeVisible()
    await page.getByTestId("preview-cms").click()
    await expect(page.getByTestId("cms-row")).toHaveCount(250)
    await page.getByTestId("apply-cms").click()
    await expect(page.getByText("Updated 250 items.")).toBeVisible({ timeout: 30_000 })
    expect(injected).toBe(true)
    expect(api.items.every((i) => (i.fieldData["main-image"] as { alt: string | null }).alt?.startsWith("Cabin"))).toBe(true)
    expect((await state(page)).notifications.some((n) => /rate limit/i.test(n.message))).toBe(true)
  })
})
