import { useMemo, useState } from "react"
import {
  auditAccessibility,
  evaluateContrast,
  parseColor,
  simulateVision,
  suggestAccessibleColor,
  type AuditIssue,
  type AuditReport,
  type ImageScope,
  type VisionDeficiency,
  type WcagLevel,
} from "@vss/core-engine"
import { Badge, Button, Card, ColorInput, EmptyState, Field, Select, Stat, Status, TextInput } from "../components.tsx"
import { useAction, useSuite } from "../context.tsx"
import { SCOPE_LABELS } from "./AltTextPanel.tsx"

const CVD: VisionDeficiency[] = ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"]

function PassBadge({ pass, label }: { pass: boolean; label: string }) {
  return (
    <Badge tone={pass ? "success" : "danger"}>
      {pass ? "✓" : "✕"} {label}
    </Badge>
  )
}

export function ContrastChecker() {
  const [fg, setFg] = useState("#999999")
  const [bg, setBg] = useState("#111111")
  const [size, setSize] = useState("16")
  const [bold, setBold] = useState(false)

  const result = useMemo(() => {
    try {
      return evaluateContrast(fg, bg, { fontSizePx: Number(size) || 16, fontWeight: bold ? 700 : 400 })
    } catch {
      return null
    }
  }, [fg, bg, size, bold])
  const suggestions = useMemo(() => {
    if (!result) return []
    const target = result.largeText ? 4.5 : 7
    const aa = suggestAccessibleColor(fg, bg, result.largeText ? 3 : 4.5)[0]
    const aaa = suggestAccessibleColor(fg, bg, target)[0]
    return [aa && !result.aa ? { level: "AA", ...aa } : null, aaa && !result.aaa ? { level: "AAA", ...aaa } : null].filter(
      (x): x is NonNullable<typeof x> => x !== null,
    )
  }, [fg, bg, result])

  return (
    <Card title="Contrast checker">
      <div className="vss-grid-2">
        <ColorInput label="Text color" value={fg} onChange={setFg} />
        <ColorInput label="Background" value={bg} onChange={setBg} />
      </div>
      <div className="vss-grid-2">
        <Field label="Font size (px)">{(id) => <TextInput id={id} type="number" min={6} max={200} value={size} onChange={(e) => setSize(e.target.value)} />}</Field>
        <label className="vss-check" style={{ alignSelf: "end", height: "var(--vss-control-h)" }}>
          <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Bold (700+)
        </label>
      </div>
      {result ? (
        <>
          <div className="vss-contrast-preview" style={{ background: result.background, color: result.foreground }}>
            <span className="vss-ratio" data-testid="contrast-ratio">
              {result.displayRatio}:1
            </span>
            <span style={{ fontSize: `${Math.min(Number(size) || 16, 32)}px`, fontWeight: bold ? 700 : 400 }}>The quick brown fox</span>
          </div>
          <div className="vss-row" data-testid="contrast-badges">
            <PassBadge pass={result.aa} label={`AA ${result.largeText ? "large" : "normal"}`} />
            <PassBadge pass={result.aaa} label={`AAA ${result.largeText ? "large" : "normal"}`} />
            <PassBadge pass={result.nonText} label="UI 3:1" />
          </div>
          {suggestions.length > 0 && (
            <div className="vss-stack" style={{ gap: 4 }}>
              <span className="vss-label">Closest passing text colors</span>
              <div className="vss-row">
                {suggestions.map((s) => (
                  <Button key={s.level} size="sm" variant="ghost" onClick={() => setFg(s.color)} data-testid={`suggest-${s.level}`}>
                    <span className="vss-swatch" style={{ background: s.color }} /> {s.color} ({s.level} {s.ratio.toFixed(2)})
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="vss-row" aria-label="Color vision simulation">
            {CVD.map((t) => (
              <span key={t} className="vss-badge" title={t}>
                <span className="vss-swatch" style={{ background: simulateVision(bg, t) }}>
                  <span style={{ display: "block", width: 8, height: 8, margin: 4, borderRadius: 2, background: simulateVision(fg, t) }} />
                </span>
                {t.replace("anopia", "").replace("achromatopsia", "mono")}
              </span>
            ))}
          </div>
        </>
      ) : (
        <span className="vss-error-text">Enter valid colors (hex, rgb() or hsl()).</span>
      )}
    </Card>
  )
}

function IssueRow({ issue, onFix }: { issue: AuditIssue; onFix?: (i: AuditIssue) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const fix = issue.fix
  return (
    <div className={`vss-issue vss-issue--${issue.severity}`} data-testid="audit-issue">
      <div className="vss-row vss-row--between">
        <strong>{issue.nodeName || issue.rule.replace(/-/g, " ")}</strong>
        <div className="vss-row" style={{ gap: 4 }}>
          <Badge tone={issue.severity === "critical" ? "danger" : issue.severity === "serious" ? "warning" : "neutral"}>{issue.severity}</Badge>
          <Badge>{issue.criterion === "SEO" || issue.criterion === "best-practice" ? issue.level : `WCAG ${issue.criterion}`}</Badge>
        </div>
      </div>
      <span className="vss-muted">{issue.message}</span>
      {fix && fix.type === "color" && (
        <span className="vss-help">
          Suggested: <span className="vss-swatch" style={{ background: fix.value, verticalAlign: "middle" }} /> {fix.value} ({fix.ratio.toFixed(2)}:1)
        </span>
      )}
      {fix && fix.type === "alt" && <span className="vss-help">Suggested alt: {fix.decorative ? '"" (decorative)' : `“${fix.value}”`}</span>}
      {fix && fix.type === "aria-label" && <span className="vss-help">Suggested aria-label: “{fix.value}”</span>}
      {fix && fix.type === "manual" && <span className="vss-help">{fix.hint}</span>}
      {onFix && fix && fix.type !== "manual" && issue.nodeId && (
        <div>
          <Button
            size="sm"
            variant={done ? "ghost" : "primary"}
            disabled={done}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onFix(issue)
                setDone(true)
              } finally {
                setBusy(false)
              }
            }}
          >
            {done ? "Fixed" : "Apply fix"}
          </Button>
        </div>
      )}
    </div>
  )
}

export function AuditPanel() {
  const { adapter, settings, metered, updateSettings } = useSuite()
  const { pending, run } = useAction()
  const [scope, setScope] = useState<ImageScope>("page")
  const [report, setReport] = useState<AuditReport | null>(null)
  const [status, setStatus] = useState("")
  const level = settings.level

  const audit = () =>
    run("audit", async () => {
      await metered("audit", async () => {
        const { nodes, page } = await adapter.collectAuditNodes(scope)
        const r = auditAccessibility({ nodes, page, level, keywords: settings.keywords })
        setReport(r)
        setStatus(`Checked ${r.checks} items — ${r.issues.length} issue${r.issues.length === 1 ? "" : "s"}.`)
      })
    })

  const onFix = adapter.applyAuditFix
    ? async (issue: AuditIssue) => {
        const ok = await adapter.applyAuditFix!(issue)
        adapter.notify(ok ? "Fix applied" : "Couldn't apply this fix automatically", ok ? "success" : "warning")
      }
    : undefined

  const scopeOptions = (["selection", "page", "project"] as ImageScope[])
    .filter((s) => s !== "selection" || adapter.capabilities.selection)
    .map((s) => ({ value: s, label: SCOPE_LABELS[s] }))

  return (
    <div className="vss-stack" data-testid="panel-audit">
      <ContrastChecker />
      <Card title="Accessibility & SEO audit">
        <div className="vss-row">
          <Select aria-label="Audit scope" value={scope} onChange={(e) => setScope(e.target.value as ImageScope)} options={scopeOptions} />
          <Select
            aria-label="WCAG level"
            value={level}
            onChange={(e) => void updateSettings({ level: e.target.value as WcagLevel })}
            options={[
              { value: "AA", label: "WCAG 2.2 AA" },
              { value: "AAA", label: "WCAG 2.2 AAA" },
            ]}
          />
          <Button variant="primary" onClick={audit} loading={pending === "audit"} data-testid="run-audit">
            Run audit
          </Button>
        </div>
        <Status>{status}</Status>
      </Card>
      {report && (
        <>
          <div className="vss-stats">
            <Stat label="Score" value={report.score} tone={report.score >= 90 ? "success" : report.score >= 60 ? "warning" : "danger"} />
            <Stat label="Critical" value={report.summary.critical} tone={report.summary.critical ? "danger" : undefined} />
            <Stat label="Serious" value={report.summary.serious} tone={report.summary.serious ? "warning" : undefined} />
            <Stat label="Moderate" value={report.summary.moderate} />
          </div>
          {report.issues.length === 0 ? (
            <EmptyState>No issues found at {report.level}. 🎉</EmptyState>
          ) : (
            <div className="vss-list">
              {report.issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} onFix={onFix} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function isValidColor(value: string): boolean {
  return parseColor(value) !== null
}
