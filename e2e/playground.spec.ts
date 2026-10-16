import { expect, test } from "@playwright/test"
import { PLAYGROUND_URL, axeViolations } from "./helpers.ts"

test.describe("Interactive playground", () => {
  test.use({ viewport: { width: 1100, height: 860 } })

  test("switches between Framer, Webflow and light themes", async ({ page }) => {
    await page.goto(PLAYGROUND_URL)
    const root = page.locator(".vss-root")
    await expect(root).toHaveCSS("background-color", "rgb(17, 17, 17)")
    await page.getByTestId("pg-theme").selectOption("webflow")
    await expect(root).toHaveCSS("background-color", "rgb(30, 30, 30)")
    await page.getByTestId("pg-theme").selectOption("light")
    await expect(root).toHaveCSS("background-color", "rgb(255, 255, 255)")
  })

  for (const theme of ["framer", "webflow", "light"]) {
    test(`every tab passes axe WCAG 2.2 AA in the ${theme} theme`, async ({ page }) => {
      await page.goto(`${PLAYGROUND_URL}?theme=${theme}`)
      for (const tab of ["Alt text", "Meta", "CMS", "Contrast & A11y", "Schema", "SVG", "Settings"]) {
        await page.getByRole("tab", { name: tab }).click()
        if (tab === "Schema") await page.getByTestId("load-example").click()
        if (tab === "Meta") await page.getByText(/Analysing/).waitFor()
        expect(await axeViolations(page), `${theme} / ${tab}`).toEqual([])
      }
    })
  }

  test("contrast checker reacts live and suggestions fix failures", async ({ page }) => {
    await page.goto(PLAYGROUND_URL)
    await page.getByRole("tab", { name: "Contrast & A11y" }).click()
    await page.getByLabel("Text color", { exact: true }).fill("#333333")
    await expect(page.getByTestId("contrast-badges")).toContainText("✕ AA normal")
    await page.getByTestId("suggest-AA").click()
    await expect(page.getByTestId("contrast-badges")).toContainText("✓ AA normal")
  })

  test("SVG minifier accepts pasted markup and sanitizes scripts", async ({ page }) => {
    await page.goto(PLAYGROUND_URL)
    await page.getByRole("tab", { name: "SVG" }).click()
    await page
      .getByTestId("svg-input")
      .fill('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><script>alert(1)</script><rect width="10.000" height="10.000" fill="#FFFFFF"/></svg>')
    await expect(page.getByTestId("svg-output")).toHaveText('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>')
    await expect(page.getByTestId("svg-stats")).toContainText("Removed unsafe <script> element")
  })
})
