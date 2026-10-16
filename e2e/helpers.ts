import type { Page, Route } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

export const FRAMER_URL = "http://localhost:4301/"
export const WEBFLOW_URL = "http://localhost:4302/"
export const PLAYGROUND_URL = "http://localhost:4303/"

export interface LicenseMock {
  consumed: string[]
  remaining: () => number
  setPro: (pro: boolean) => void
}

/** Mocks the license worker at https://license.test (configured via .env.e2e). */
export async function mockLicense(page: Page, { limit = 10, used = 0 } = {}): Promise<LicenseMock> {
  let count = used
  let pro = false
  const consumed: string[] = []
  const body = (allowed: boolean) =>
    pro
      ? { plan: "pro", allowed: true, remaining: null, limit, used: count, checkoutUrl: null }
      : { plan: "free", allowed, remaining: Math.max(0, limit - count), limit, used: count, checkoutUrl: "https://polar.sh/checkout/e2e" }
  await page.route("https://license.test/v1/usage/**", async (route: Route) => {
    const url = route.request().url()
    const payload = route.request().postDataJSON() as { feature?: string; licenseKey?: string | null }
    if (payload?.licenseKey === "PRO-KEY") pro = true
    if (url.endsWith("/consume")) {
      if (!pro && count >= limit) return route.fulfill({ status: 402, json: body(false) })
      count++
      consumed.push(payload.feature ?? "?")
      return route.fulfill({ json: body(true) })
    }
    return route.fulfill({ json: body(pro || count < limit) })
  })
  await page.route("https://license.test/v1/license/validate", async (route) => {
    const { key } = route.request().postDataJSON() as { key: string }
    if (key === "PRO-KEY") {
      pro = true
      return route.fulfill({ json: { valid: true, plan: "pro", status: "granted" } })
    }
    return route.fulfill({ json: { valid: false, plan: "free", message: "License key not found." } })
  })
  return { consumed, remaining: () => limit - count, setPro: (p) => (pro = p) }
}

/** Run axe-core WCAG 2.x A/AA checks on the plugin root. */
export async function axeViolations(page: Page) {
  // Let CSS transitions (e.g. disabled → enabled buttons) settle so colors are measured at rest.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))))
  const results = await new AxeBuilder({ page }).include(".vss-root").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  return results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }))
}
