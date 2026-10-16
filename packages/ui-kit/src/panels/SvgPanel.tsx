import { useMemo, useState } from "react"
import { isLikelySvg, minifySvg, type SvgMinifyResult } from "@vss/core-engine"
import { Badge, Button, Card, Checkbox, Field, Status, TextArea, TextInput } from "../components.tsx"
import { copyToClipboard, useAction, useSuite } from "../context.tsx"

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

function dataUri(svg: string): string {
  // Rendering through <img> never executes scripts inside the SVG.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function SvgPanel() {
  const { adapter } = useSuite()
  const { pending, run } = useAction()
  const [input, setInput] = useState("")
  const [name, setName] = useState("optimized.svg")
  const [precision, setPrecision] = useState(3)
  const [keepTitle, setKeepTitle] = useState(true)
  const [responsive, setResponsive] = useState(false)
  const [ariaLabel, setAriaLabel] = useState("")
  const [status, setStatus] = useState("")

  const output = useMemo<{ result: SvgMinifyResult | null; error: string | null }>(() => {
    if (!input.trim()) return { result: null, error: null }
    if (!isLikelySvg(input)) return { result: null, error: "Paste a complete <svg>…</svg> document." }
    try {
      return { result: minifySvg(input, { precision, keepTitle, responsive, ariaLabel: ariaLabel.trim() || null }), error: null }
    } catch (e) {
      return { result: null, error: (e as Error).message }
    }
  }, [input, precision, keepTitle, responsive, ariaLabel])

  const loadSelected = () =>
    run("load", async () => {
      const sel = await adapter.getSelectedSvg?.()
      if (!sel) {
        adapter.notify("Select an SVG layer first", "info")
        return
      }
      setInput(sel.svg)
      if (sel.name) setName(sel.name.endsWith(".svg") ? sel.name : `${sel.name}.svg`)
    })

  const insert = () =>
    run("insert", async () => {
      if (!output.result || !adapter.insertSvg) return
      await adapter.insertSvg(output.result.svg, name)
      adapter.notify("Optimized SVG inserted", "success")
      setStatus("Inserted into canvas.")
    })

  const r = output.result
  return (
    <div className="vss-stack" data-testid="panel-svg">
      <Card
        title="SVG minifier"
        actions={
          <div className="vss-row" style={{ gap: 4 }}>
            {adapter.getSelectedSvg && (
              <Button size="sm" variant="ghost" onClick={loadSelected} loading={pending === "load"}>
                Use selection
              </Button>
            )}
            <label className="vss-btn vss-btn--ghost vss-btn--sm" style={{ cursor: "pointer" }}>
              Upload
              <input
                type="file"
                accept=".svg,image/svg+xml"
                className="vss-sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setInput(await file.text())
                  setName(file.name)
                }}
              />
            </label>
          </div>
        }
      >
        <Field label="SVG markup">
          {(id) => (
            <TextArea id={id} rows={5} className="vss-textarea vss-mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="<svg …>…</svg>" data-testid="svg-input" spellCheck={false} />
          )}
        </Field>
        <div className="vss-grid-2">
          <Field label={`Precision: ${precision} decimals`}>
            {(id) => <input id={id} type="range" min={0} max={5} value={precision} onChange={(e) => setPrecision(Number(e.target.value))} />}
          </Field>
          <Field label="Accessible name (optional)">
            {(id) => <TextInput id={id} value={ariaLabel} onChange={(e) => setAriaLabel(e.target.value)} placeholder="Company logo" />}
          </Field>
        </div>
        <div className="vss-row">
          <Checkbox label="Keep <title>" checked={keepTitle} onChange={(e) => setKeepTitle(e.target.checked)} />
          <Checkbox label="Responsive (drop width/height)" checked={responsive} onChange={(e) => setResponsive(e.target.checked)} />
        </div>
      </Card>

      {output.error && <span className="vss-error-text">{output.error}</span>}
      {r && (
        <>
          <div className="vss-row" data-testid="svg-stats">
            <Badge>{formatBytes(r.originalBytes)}</Badge>→<Badge tone="success">{formatBytes(r.minifiedBytes)}</Badge>
            <Badge tone="accent">−{r.savingsPercent}%</Badge>
            {r.warnings.map((w) => (
              <Badge key={w} tone="warning">
                {w}
              </Badge>
            ))}
          </div>
          <div className="vss-svg-preview">
            <figure>
              <img src={dataUri(input)} alt="Original SVG preview" />
              <figcaption className="vss-help">Original</figcaption>
            </figure>
            <figure>
              <img src={dataUri(r.svg)} alt="Optimized SVG preview" />
              <figcaption className="vss-help">Optimized</figcaption>
            </figure>
          </div>
          <pre className="vss-code" data-testid="svg-output" tabIndex={0} role="region" aria-label="Optimized SVG markup">{r.svg}</pre>
          <div className="vss-row">
            {adapter.insertSvg && (
              <Button variant="primary" onClick={insert} loading={pending === "insert"}>
                Insert into canvas
              </Button>
            )}
            <Button
              onClick={async () => {
                const ok = await copyToClipboard(r.svg)
                adapter.notify(ok ? "SVG copied" : "Copy failed", ok ? "success" : "warning")
              }}
            >
              Copy
            </Button>
          </div>
        </>
      )}
      <Status>{status}</Status>
    </div>
  )
}
