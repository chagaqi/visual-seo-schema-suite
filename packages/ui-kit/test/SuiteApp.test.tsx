import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { LicenseClient, memoryStore, type UsageStatus } from "@vss/core-engine"
import { SuiteApp, THEMES, createMockAdapter, themeToCssVars } from "../src/index.ts"

function setup(props: Partial<Parameters<typeof SuiteApp>[0]> = {}) {
  const adapter = createMockAdapter()
  const user = userEvent.setup()
  const utils = render(<SuiteApp adapter={adapter} theme="framer" {...props} />)
  return { adapter, user, ...utils }
}

describe("theme", () => {
  it("maps tokens to CSS variables with Framer #111111 fallback", () => {
    const vars = themeToCssVars(THEMES.framer)
    expect(vars["--vss-bg"]).toBe("var(--framer-color-bg, #111111)")
    expect(themeToCssVars(THEMES.webflow)["--vss-bg"]).toBe("#1e1e1e")
  })

  it("renders the root with host + theme attributes", () => {
    const { container } = setup({ theme: "webflow" })
    const root = container.querySelector(".vss-root") as HTMLElement
    expect(root.dataset.vssTheme).toBe("webflow")
    expect(root.dataset.vssHost).toBe("playground")
    expect(root.style.getPropertyValue("--vss-button-bg")).toBe("#006acc")
  })
})

describe("SuiteApp navigation", () => {
  it("shows all tools as accessible tabs with keyboard navigation", async () => {
    const { user } = setup()
    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual(["Alt text", "Meta", "CMS", "Contrast & A11y", "Schema", "SVG", "Settings"])
    tabs[0]!.focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Meta" })).toHaveAttribute("aria-selected", "true")
  })

  it("hides the CMS tab when the host has no CMS support", () => {
    const adapter = createMockAdapter()
    ;(adapter as { capabilities: typeof adapter.capabilities }).capabilities = { ...adapter.capabilities, cms: false }
    render(<SuiteApp adapter={adapter} />)
    expect(screen.queryByRole("tab", { name: "CMS" })).toBeNull()
  })
})

describe("Alt text panel", () => {
  it("scans, generates, edits and applies alt text", async () => {
    const { adapter, user } = setup()
    await user.selectOptions(screen.getByLabelText("Image scope"), "page")
    await user.click(screen.getByRole("button", { name: "Scan" }))
    expect(await screen.findByText(/Found 4 images/)).toBeInTheDocument()
    await user.click(screen.getByTestId("generate-alt"))
    await screen.findByText(/Generated 4 suggestions/)

    const heroField = screen.getByLabelText("Alt text for Image") as HTMLTextAreaElement
    expect(heroField.value).toBe("Barista pouring latte art")
    await user.clear(heroField)
    await user.type(heroField, "Barista pouring a rosetta into a latte")

    expect(screen.getAllByText("Decorative").length).toBeGreaterThan(0)
    await user.click(screen.getByTestId("apply-alt"))
    await waitFor(() => expect(adapter.state.images.find((i) => i.id === "img-hero")!.alt).toBe("Barista pouring a rosetta into a latte"))
    expect(adapter.state.images.find((i) => i.id === "img-divider")!.alt).toBe("")
    expect(adapter.state.images.find((i) => i.id === "img-logo")!.alt).toBe("Blue Door logo")
    await waitFor(() => expect(adapter.state.notifications.at(-1)?.variant).toBe("success"))
  })
})

describe("Meta panel", () => {
  it("generates and saves a description within limits", async () => {
    const { adapter, user } = setup({ initialTab: "meta" })
    await screen.findByText(/Analysing/)
    await user.click(screen.getByTestId("generate-meta"))
    const textarea = (await screen.findByTestId("meta-description")) as HTMLTextAreaElement
    await waitFor(() => expect(textarea.value.length).toBeGreaterThan(80))
    expect(textarea.value.length).toBeLessThanOrEqual(155)
    expect(screen.getByLabelText("Google search preview")).toHaveTextContent(textarea.value)
    await user.click(screen.getByTestId("apply-meta"))
    await waitFor(() => expect(adapter.state.pageMeta.description).toBe(textarea.value))
  })
})

describe("CMS panel", () => {
  it("previews and applies bulk meta descriptions", async () => {
    const { adapter, user } = setup({ initialTab: "cms" })
    await user.click(screen.getByTestId("load-collections"))
    await user.selectOptions(await screen.findByLabelText("Collection"), "blog")
    await screen.findByText(/3 items loaded/)
    await user.selectOptions(screen.getByLabelText("Task"), "meta")
    await user.click(screen.getByTestId("preview-cms"))
    const rows = await screen.findAllByTestId("cms-row")
    expect(rows).toHaveLength(3)
    await user.click(screen.getByTestId("apply-cms"))
    await waitFor(() => expect(String(adapter.state.items.blog![0]!.fieldData["f-meta"])).toMatch(/pour-over/i))
  })

  it("previews and applies bulk image alt text", async () => {
    const { adapter, user } = setup({ initialTab: "cms" })
    await user.click(screen.getByTestId("load-collections"))
    await user.selectOptions(await screen.findByLabelText("Collection"), "blog")
    await screen.findByText(/3 items loaded/)
    await user.click(screen.getByTestId("preview-cms"))
    await screen.findAllByTestId("cms-row")
    await user.click(screen.getByTestId("apply-cms"))
    await waitFor(() => {
      const cover = adapter.state.items.blog![1]!.fieldData["f-cover"] as { alt: string }
      expect(cover.alt).toBe("Meet our Ethiopian farmers")
    })
  })
})

describe("Contrast & audit panel", () => {
  it("evaluates contrast live and applies suggestions", async () => {
    const { user } = setup({ initialTab: "audit" })
    const text = screen.getByLabelText("Text color")
    await user.clear(text)
    await user.type(text, "#444444")
    expect(screen.getByTestId("contrast-ratio").textContent).toMatch(/^1\.\d+:1$/)
    expect(within(screen.getByTestId("contrast-badges")).getByText(/^. AA normal$/).textContent).toContain("✕")
    await user.click(screen.getByTestId("suggest-AA"))
    expect(within(screen.getByTestId("contrast-badges")).getByText(/^. AA normal$/).textContent).toContain("✓")
  })

  it("runs the page audit and applies a fix", async () => {
    const { adapter, user } = setup({ initialTab: "audit" })
    await user.click(screen.getByTestId("run-audit"))
    const issues = await screen.findAllByTestId("audit-issue")
    expect(issues.length).toBeGreaterThan(3)
    const subtitle = issues.find((i) => i.textContent?.includes("Hero subtitle"))!
    await user.click(within(subtitle).getByRole("button", { name: "Apply fix" }))
    await waitFor(() => expect(adapter.state.auditNodes.find((n) => n.id === "t-sub")!.kind === "text" && (adapter.state.auditNodes.find((n) => n.id === "t-sub") as { color: string }).color).not.toBe("#555555"))
  })
})

describe("Schema panel", () => {
  it("validates live, shows field errors and installs markup", async () => {
    const { adapter, user } = setup({ initialTab: "schema" })
    expect(screen.getByTestId("schema-validation")).toHaveTextContent(/error/)
    expect(screen.getByTestId("save-schema")).toBeDisabled()
    await user.click(screen.getByTestId("load-example"))
    expect(screen.getByTestId("schema-validation")).toHaveTextContent("Valid")
    expect(screen.getByTestId("schema-validation")).toHaveTextContent("Rich result eligible")
    await user.click(screen.getByTestId("save-schema"))
    await waitFor(() => expect(adapter.state.structuredData.site).toHaveLength(1))
    expect(adapter.state.structuredData.site[0]!["@type"]).toBe("CafeOrCoffeeShop")
    expect(await screen.findByTestId("saved-schemas")).toHaveTextContent("Blue Door Coffee")
  })

  it("builds FAQ markup imported from the page", async () => {
    const { adapter, user } = setup({ initialTab: "schema" })
    await user.click(screen.getByTestId("schema-type-FAQPage"))
    await user.click(screen.getByRole("button", { name: "Import from page" }))
    await screen.findByText(/Imported 2 questions/)
    expect(screen.getAllByTestId("list-item-mainEntity")).toHaveLength(2)
    await user.click(screen.getByTestId("save-schema"))
    await waitFor(() => expect(adapter.state.structuredData.page).toHaveLength(1))
    expect(JSON.stringify(adapter.state.structuredData.page[0])).toContain("Do you ship internationally?")
  })

  it("flags invalid formats inline", async () => {
    const { user } = setup({ initialTab: "schema" })
    await user.click(screen.getByTestId("schema-type-Product"))
    await user.type(screen.getByLabelText(/Product name/), "Kettle")
    await user.type(screen.getByLabelText(/Currency/), "usd")
    expect(await screen.findByText(/3-letter ISO 4217/)).toBeInTheDocument()
  })

  it("validates pasted JSON-LD", async () => {
    const { user } = setup({ initialTab: "schema" })
    const area = screen.getByLabelText("Paste JSON-LD to validate")
    await user.click(area)
    await user.paste('{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}')
    expect(await screen.findByTestId("paste-result")).toHaveTextContent("Invalid")
  })
})

describe("SVG panel", () => {
  it("minifies the selected SVG and inserts it", async () => {
    const { adapter, user } = setup({ initialTab: "svg" })
    await user.click(screen.getByRole("button", { name: "Use selection" }))
    expect(await screen.findByTestId("svg-stats")).toHaveTextContent(/−\d+(\.\d)?%/)
    expect(screen.getByTestId("svg-output").textContent).not.toMatch(/sketch|<desc|<\?xml/)
    await user.click(screen.getByRole("button", { name: "Insert into canvas" }))
    await waitFor(() => expect(adapter.state.insertedSvgs).toHaveLength(1))
    expect(adapter.state.insertedSvgs[0]!.name).toBe("cup-icon.svg")
  })
})

describe("Licensing", () => {
  function fakeLicense(statuses: UsageStatus[]) {
    const client = new LicenseClient({ baseUrl: "https://lic.test", host: "playground", getUserId: async () => "u", storage: memoryStore() })
    let i = 0
    vi.spyOn(client, "status").mockResolvedValue(statuses[0]!)
    vi.spyOn(client, "consume").mockImplementation(async () => statuses[Math.min(++i, statuses.length - 1)]!)
    return client
  }

  it("shows the usage meter and blocks with an upgrade dialog when exhausted", async () => {
    const license = fakeLicense([
      { plan: "free", allowed: true, remaining: 1, limit: 10, used: 9 },
      { plan: "free", allowed: false, remaining: 0, limit: 10, used: 10, checkoutUrl: "https://polar.sh/checkout/x" },
    ])
    const { user } = setup({ initialTab: "audit", license })
    expect(await screen.findByTestId("usage")).toHaveTextContent("1/10 free")
    await user.click(screen.getByTestId("run-audit"))
    expect(await screen.findByTestId("upgrade-dialog")).toBeInTheDocument()
    expect(screen.queryAllByTestId("audit-issue")).toHaveLength(0)
    expect(screen.getByRole("link", { name: "Buy Pro" })).toHaveAttribute("href", "https://polar.sh/checkout/x")
  })
})

describe("Settings", () => {
  it("persists site defaults and AI settings to the right stores", async () => {
    const { adapter, user } = setup({ initialTab: "settings" })
    await user.type(screen.getByLabelText("Brand / site name"), "Blue Door")
    await user.click(screen.getByRole("button", { name: "Save defaults" }))
    await waitFor(async () => expect(JSON.parse((await adapter.projectStorage.get("vss:settings"))!).brand).toBe("Blue Door"))
    await user.selectOptions(screen.getByLabelText("Provider"), "anthropic")
    await user.type(screen.getByLabelText("API key"), "sk-ant-test")
    await user.click(screen.getByRole("button", { name: "Save AI settings" }))
    await waitFor(async () => expect(JSON.parse((await adapter.deviceStorage.get("vss:ai"))!).apiKey).toBe("sk-ant-test"))
    expect(await adapter.projectStorage.get("vss:ai")).toBeNull()
  })
})
