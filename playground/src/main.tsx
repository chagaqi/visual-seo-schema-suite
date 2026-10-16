import React, { useMemo, useState } from "react"
import ReactDOM from "react-dom/client"
import { SuiteApp, createMockAdapter, type MockAdapter, type ThemeName } from "@vss/ui-kit"
import "@vss/ui-kit/styles.css"
import "./playground.css"

declare global {
  interface Window {
    __VSS_MOCK__?: MockAdapter
  }
}

const THEME_LABELS: Record<ThemeName, string> = { framer: "Framer (dark)", webflow: "Webflow Designer", light: "Light" }

function Playground() {
  const params = new URLSearchParams(location.search)
  const [theme, setTheme] = useState<ThemeName>((params.get("theme") as ThemeName) || "framer")
  const [width, setWidth] = useState(Number(params.get("width")) || 360)
  const [seed, setSeed] = useState(0)
  const adapter = useMemo(() => {
    const a = createMockAdapter({}, { latencyMs: 60 })
    window.__VSS_MOCK__ = a
    return a
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  return (
    <div className="pg">
      <aside className="pg-controls" aria-label="Playground controls">
        <h1>Visual SEO &amp; Schema Suite</h1>
        <p>Interactive playground with a simulated host. Everything runs locally in your browser — no API keys, no network.</p>
        <label>
          Theme
          <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeName)} data-testid="pg-theme">
            {(Object.keys(THEME_LABELS) as ThemeName[]).map((t) => (
              <option key={t} value={t}>
                {THEME_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Panel width: {width}px
          <input type="range" min={280} max={600} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        <button type="button" onClick={() => setSeed((s) => s + 1)}>
          Reset mock project
        </button>
        <details>
          <summary>Mock host state</summary>
          <pre data-testid="pg-state">{JSON.stringify({ images: adapter.state.images.map((i) => ({ id: i.id, alt: i.alt })) }, null, 2)}</pre>
        </details>
      </aside>
      <div className="pg-frame" style={{ width }} data-testid="pg-frame">
        <SuiteApp key={`${seed}-${theme}`} adapter={adapter} theme={theme} />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Playground />
  </React.StrictMode>,
)
