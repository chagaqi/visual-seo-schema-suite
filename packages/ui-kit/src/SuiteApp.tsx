import { useEffect, useState, type CSSProperties } from "react"
import type { HostAdapter, LicenseClient } from "@vss/core-engine"
import { Dialog, Logo } from "./components.tsx"
import { SuiteProvider, useSuite } from "./context.tsx"
import { AltTextPanel } from "./panels/AltTextPanel.tsx"
import { AuditPanel } from "./panels/AuditPanel.tsx"
import { CmsPanel } from "./panels/CmsPanel.tsx"
import { MetaPanel } from "./panels/MetaPanel.tsx"
import { SchemaPanel } from "./panels/SchemaPanel.tsx"
import { LicenseForm, SettingsPanel, UsageMeter } from "./panels/SettingsPanel.tsx"
import { SvgPanel } from "./panels/SvgPanel.tsx"
import { THEMES, themeToCssVars, type ThemeName } from "./theme.ts"

export type TabId = "alt" | "meta" | "cms" | "audit" | "schema" | "svg" | "settings"

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "alt", label: "Alt text" },
  { id: "meta", label: "Meta" },
  { id: "cms", label: "CMS" },
  { id: "audit", label: "Contrast & A11y" },
  { id: "schema", label: "Schema" },
  { id: "svg", label: "SVG" },
  { id: "settings", label: "Settings" },
]

export interface SuiteAppProps {
  adapter: HostAdapter
  theme?: ThemeName
  license?: LicenseClient | null
  /** Polar.sh checkout link shown when the free quota runs out. */
  checkoutUrl?: string
  initialTab?: TabId
}

function UpgradeDialog() {
  const { upgradeOpen, setUpgradeOpen, usage } = useSuite()
  if (!upgradeOpen) return null
  return (
    <Dialog title="You've used your free credits" onClose={() => setUpgradeOpen(false)}>
      <p className="vss-muted" style={{ margin: 0 }} data-testid="upgrade-dialog">
        The free plan includes {usage?.limit ?? 10} audits & generations. Upgrade to Pro for unlimited bulk alt text, CMS updates, audits and schema — SVG minifying and the contrast checker stay free forever.
      </p>
      <LicenseForm onActivated={() => setUpgradeOpen(false)} />
    </Dialog>
  )
}

function Shell({ initialTab }: { initialTab: TabId }) {
  const { adapter } = useSuite()
  const tabs = TABS.filter((t) => t.id !== "cms" || adapter.capabilities.cms)
  const [tab, setTab] = useState<TabId>(tabs.some((t) => t.id === initialTab) ? initialTab : "alt")

  return (
    <>
      <header className="vss-header">
        <div className="vss-brand">
          <Logo />
          <span>Visual SEO &amp; Schema</span>
        </div>
        <UsageMeter />
      </header>
      <nav className="vss-tabs" role="tablist" aria-label="Tools">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`vss-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`vss-panel-${t.id}`}
            className="vss-tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const idx = tabs.findIndex((x) => x.id === tab)
              if (e.key === "ArrowRight") setTab(tabs[(idx + 1) % tabs.length]!.id)
              if (e.key === "ArrowLeft") setTab(tabs[(idx - 1 + tabs.length) % tabs.length]!.id)
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="vss-panel" role="tabpanel" id={`vss-panel-${tab}`} aria-labelledby={`vss-tab-${tab}`}>
        {tab === "alt" && <AltTextPanel />}
        {tab === "meta" && <MetaPanel />}
        {tab === "cms" && <CmsPanel />}
        {tab === "audit" && <AuditPanel />}
        {tab === "schema" && <SchemaPanel />}
        {tab === "svg" && <SvgPanel />}
        {tab === "settings" && <SettingsPanel />}
      </main>
      <UpgradeDialog />
    </>
  )
}

/** The complete suite UI, host-agnostic. Hosts pass an adapter + theme. */
export function SuiteApp({ adapter, theme = "framer", license = null, checkoutUrl = "https://polar.sh", initialTab = "alt" }: SuiteAppProps) {
  const style = themeToCssVars(THEMES[theme]) as CSSProperties
  useEffect(() => {
    // Paint the iframe body too so overscroll never flashes white.
    document.body.style.margin = "0"
    document.body.style.background = THEMES[theme].bg
  }, [theme])
  return (
    <div className="vss-root" data-vss-theme={theme} data-vss-host={adapter.name} style={style}>
      <SuiteProvider adapter={adapter} license={license} checkoutUrl={checkoutUrl}>
        <Shell initialTab={initialTab} />
      </SuiteProvider>
    </div>
  )
}
