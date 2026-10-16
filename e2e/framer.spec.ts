import { expect, test } from "@playwright/test"
import { FRAMER_URL, axeViolations, mockLicense } from "./helpers.ts"

type FakeFramerWindow = Window & {
  __VSS_FAKE_FRAMER__: {
    state: {
      nodes: Map<string, { backgroundImage?: { altText?: string } | null; pluginData: Map<string, string> }>
      selection: string[]
      customCode: Record<string, string | null>
      addedSvgs: Array<{ svg: string; name?: string }>
      notifications: Array<{ message: string; variant?: string }>
      collections: Array<{ items: Array<{ fieldData: Record<string, { value: unknown }> }> }>
    }
  }
}

test.describe("Framer plugin (headless, fake Framer host)", () => {
  test.beforeEach(async ({ page }) => {
    await mockLicense(page)
    await page.goto(FRAMER_URL)
    await expect(page.getByRole("tab", { name: "Alt text" })).toBeVisible()
  })

  test("renders the Framer dark theme (#111111) and passes axe WCAG AA", async ({ page }) => {
    await expect(page.locator(".vss-root")).toHaveAttribute("data-vss-host", "framer")
    await expect(page.locator(".vss-root")).toHaveCSS("background-color", "rgb(17, 17, 17)")
    await expect(page.getByTestId("usage")).toHaveText(/10\/10 free/)
    expect(await axeViolations(page)).toEqual([])
  })

  test("bulk alt text: scan selection → generate → apply writes ImageAsset alt via setAttributes", async ({ page }) => {
    await page.getByRole("button", { name: "Scan" }).click()
    await expect(page.getByText("Found 1 image.")).toBeVisible()
    await page.getByTestId("generate-alt").click()
    const field = page.getByLabel("Alt text for Barista pouring latte art")
    await expect(field).toHaveValue("Barista pouring latte art")
    await expect(page.getByTestId("usage")).toHaveText(/9\/10 free/)
    await page.getByTestId("apply-alt").click()
    await expect(page.getByText("Updated 1 image.")).toBeVisible()
    const alt = await page.evaluate(() => (window as unknown as FakeFramerWindow).__VSS_FAKE_FRAMER__.state.nodes.get("hero-img")!.backgroundImage!.altText)
    expect(alt).toBe("Barista pouring latte art")
    const marker = await page.evaluate(() => (window as unknown as FakeFramerWindow).__VSS_FAKE_FRAMER__.state.nodes.get("hero-img")!.pluginData.get("vss:alt"))
    expect(marker).toBe("generated")
  })

  test("page scope uses caption context for hashed CDN images and flags decorative logos", async ({ page }) => {
    await page.getByLabel("Image scope").selectOption("page")
    await page.getByRole("button", { name: "Scan" }).click()
    await expect(page.getByTestId("alt-row")).toHaveCount(3)
    await page.getByTestId("generate-alt").click()
    await expect(page.getByLabel("Alt text for Image")).toHaveValue("Our roastery in the Mission district")
  })

  test("structured data: LocalBusiness example installs a valid @graph via framer.setCustomCode(headEnd)", async ({ page }) => {
    await page.getByRole("tab", { name: "Schema" }).click()
    await expect(page.getByTestId("schema-validation")).toContainText("error")
    await page.getByTestId("load-example").click()
    await expect(page.getByTestId("schema-validation")).toContainText("Valid")
    await expect(page.getByTestId("schema-validation")).toContainText("Rich result eligible")
    await page.getByTestId("save-schema").click()
    await expect(page.getByText(/Site head updated with 1 schema block/).first()).toBeVisible()
    const head = await page.evaluate(() => (window as unknown as FakeFramerWindow).__VSS_FAKE_FRAMER__.state.customCode.headEnd)
    expect(head).toContain('<script type="application/ld+json" id="vss-structured-data">')
    expect(head).toContain('"@type":"CafeOrCoffeeShop"')
  })

  test("SVG: minifies the selected SVG layer and inserts it with framer.addSVG", async ({ page }) => {
    await page.evaluate(() => {
      ;(window as unknown as FakeFramerWindow).__VSS_FAKE_FRAMER__.state.selection = ["icon"]
    })
    await page.getByRole("tab", { name: "SVG" }).click()
    await page.getByRole("button", { name: "Use selection" }).click()
    await expect(page.getByTestId("svg-stats")).toContainText("−")
    await expect(page.getByTestId("svg-output")).not.toContainText("sketch")
    await page.getByRole("button", { name: "Insert into canvas" }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as FakeFramerWindow).__VSS_FAKE_FRAMER__.state.addedSvgs.length)).toBe(1)
    // SVG minification is free: no credit consumed
    await expect(page.getByTestId("usage")).toHaveText(/10\/10 free/)
  })

  test("CMS: bulk meta descriptions for a Framer collection", async ({ page }) => {
    await page.getByRole("tab", { name: "CMS" }).click()
    await page.getByTestId("load-collections").click()
    await page.getByLabel("Collection").selectOption({ label: "Blog" })
    await page.getByLabel("Task").selectOption("meta")
    await page.getByTestId("preview-cms").click()
    await expect(page.getByTestId("cms-row")).toHaveCount(2)
    await page.getByTestId("apply-cms").click()
    await expect(page.getByText("Updated 2 items.")).toBeVisible()
    const meta = await page.evaluate(() => (window as unknown as FakeFramerWindow).__VSS_FAKE_FRAMER__.state.collections[0]!.items[0]!.fieldData.meta!.value)
    expect(String(meta)).toMatch(/pour-over/i)
  })

  test("contrast audit finds the low-contrast subtitle and suggests an accessible color", async ({ page }) => {
    await page.getByRole("tab", { name: "Contrast & A11y" }).click()
    await page.getByTestId("run-audit").click()
    const issue = page.getByTestId("audit-issue").filter({ hasText: "Hero subtitle" })
    await expect(issue).toContainText("WCAG 1.4.3")
    await expect(issue).toContainText("Suggested")
  })
})

test.describe("Framer plugin licensing", () => {
  test("blocks with an upgrade dialog after 10 free generations and unlocks with a license key", async ({ page }) => {
    await mockLicense(page, { used: 10 })
    await page.goto(FRAMER_URL)
    await expect(page.getByTestId("usage")).toHaveText(/0\/10 free/)
    await page.getByRole("tab", { name: "Contrast & A11y" }).click()
    await page.getByTestId("run-audit").click()
    await expect(page.getByTestId("upgrade-dialog")).toBeVisible()
    await expect(page.getByRole("link", { name: "Buy Pro" })).toHaveAttribute("href", "https://polar.sh/checkout/e2e")
    await page.getByTestId("license-key").fill("PRO-KEY")
    await page.getByTestId("activate-license").click()
    await expect(page.getByTestId("upgrade-dialog")).toBeHidden()
    await expect(page.getByTestId("usage")).toHaveText("Pro")
    await page.getByTestId("run-audit").click()
    await expect(page.getByTestId("audit-issue").first()).toBeVisible()
  })
})
