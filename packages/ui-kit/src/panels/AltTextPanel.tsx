import { useMemo, useState } from "react"
import { generateBulkAltText, lintAltText, type BulkAltResult, type HostImage, type ImageScope } from "@vss/core-engine"
import { Badge, Button, Card, Checkbox, EmptyState, Progress, Select, Stat, Status, TextArea, confidenceLabel, confidenceTone } from "../components.tsx"
import { useAction, useSuite } from "../context.tsx"

interface Row {
  image: HostImage
  result: BulkAltResult | null
  draft: string
  decorative: boolean
  selected: boolean
}

export const SCOPE_LABELS: Record<ImageScope, string> = {
  selection: "Selected layers",
  page: "Current page",
  project: "Entire project",
}

export function AltTextPanel() {
  const { adapter, settings, aiConfig, ai, metered } = useSuite()
  const { pending, run } = useAction()
  const [scope, setScope] = useState<ImageScope>(adapter.capabilities.selection ? "selection" : "page")
  const [overwrite, setOverwrite] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [status, setStatus] = useState("")

  const scopeOptions = (["selection", "page", "project"] as ImageScope[])
    .filter((s) => s !== "selection" || adapter.capabilities.selection)
    .map((s) => ({ value: s, label: SCOPE_LABELS[s] }))

  const scan = () =>
    run("scan", async () => {
      const images = await adapter.listImages(scope)
      setRows(images.map((image) => ({ image, result: null, draft: image.alt ?? "", decorative: false, selected: false })))
      setStatus(images.length ? `Found ${images.length} image${images.length === 1 ? "" : "s"}.` : "No images found in this scope.")
    })

  const generate = () =>
    run("generate", async () => {
      if (!rows?.length) return
      await metered("alt-text", async () => {
        setProgress({ done: 0, total: rows.length })
        const results = await generateBulkAltText(
          rows.map((r) => ({
            id: r.image.id,
            context: {
              src: r.image.src,
              filename: r.image.filename ?? undefined,
              existingAlt: r.image.alt,
              layerName: r.image.name,
              nearbyText: r.image.nearbyText,
              collectionItemTitle: r.image.collectionItemTitle,
              pageTitle: r.image.pageTitle,
              width: r.image.width,
              height: r.image.height,
              linkHref: r.image.linkHref,
              brand: settings.brand || null,
              keywords: settings.keywords,
            },
          })),
          {
            overwrite,
            maxLength: settings.altMaxLength,
            ai: aiConfig,
            aiScope: ai.scope,
            onProgress: (done, total) => setProgress({ done, total }),
          },
        )
        const byId = new Map(results.map((r) => [r.id, r]))
        setRows((prev) =>
          (prev ?? []).map((row) => {
            const result = byId.get(row.image.id) ?? null
            const changed = !!result && result.source !== "existing" && (result.alt !== (row.image.alt ?? "") || result.decorative)
            return { ...row, result, draft: result?.alt ?? row.draft, decorative: result?.decorative ?? false, selected: changed }
          }),
        )
        const flagged = results.filter((r) => r.needsReview).length
        setStatus(`Generated ${results.length} suggestions${flagged ? ` — ${flagged} need review` : ""}.`)
      })
      setProgress(null)
    })

  const apply = () =>
    run("apply", async () => {
      const chosen = (rows ?? []).filter((r) => r.selected)
      if (!chosen.length) return
      setProgress({ done: 0, total: chosen.length })
      const res = await adapter.applyAltText(
        chosen.map((r) => ({ id: r.image.id, alt: r.decorative ? "" : r.draft.trim(), decorative: r.decorative })),
        (done, total) => setProgress({ done, total }),
      )
      setProgress(null)
      const failedIds = new Set(res.failed.map((f) => f.id))
      setRows((prev) =>
        (prev ?? []).map((r) =>
          r.selected && !failedIds.has(r.image.id)
            ? { ...r, selected: false, image: { ...r.image, alt: r.decorative ? "" : r.draft.trim() } }
            : r,
        ),
      )
      const msg = `Updated ${res.updated} image${res.updated === 1 ? "" : "s"}${res.failed.length ? `, ${res.failed.length} failed` : ""}.`
      setStatus(msg)
      adapter.notify(msg, res.failed.length ? "warning" : "success")
    })

  const stats = useMemo(() => {
    const list = rows ?? []
    return {
      total: list.length,
      missing: list.filter((r) => lintAltText(r.image.alt).some((i) => i.severity === "error")).length,
      selected: list.filter((r) => r.selected).length,
    }
  }, [rows])

  const update = (id: string, patch: Partial<Row>) =>
    setRows((prev) => (prev ?? []).map((r) => (r.image.id === id ? { ...r, ...patch } : r)))

  return (
    <div className="vss-stack" data-testid="panel-alt">
      <Card title="Bulk alt text">
        <div className="vss-row">
          <Select aria-label="Image scope" value={scope} onChange={(e) => setScope(e.target.value as ImageScope)} options={scopeOptions} />
          <Button onClick={scan} loading={pending === "scan"}>
            Scan
          </Button>
        </div>
        <Checkbox label="Replace existing alt text that already passes" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        <p className="vss-help" style={{ margin: 0 }}>
          {aiConfig ? `AI assist on (${ai.provider}) for ${ai.scope === "all" ? "all images" : "low-confidence images"}.` : "Rule-based engine — no API key needed. Add your own AI key in Settings for tougher images."}
        </p>
      </Card>

      {rows && rows.length > 0 && (
        <>
          <div className="vss-stats">
            <Stat label="Images" value={stats.total} />
            <Stat label="Missing / bad alt" value={stats.missing} tone={stats.missing ? "danger" : "success"} />
            <Stat label="Selected" value={stats.selected} />
          </div>
          <Button variant="primary" block onClick={generate} loading={pending === "generate"} data-testid="generate-alt">
            Generate alt text
          </Button>
        </>
      )}

      {progress && <Progress value={progress.done} max={progress.total} label="Alt text progress" />}
      <Status>{status}</Status>

      {rows && rows.length === 0 && <EmptyState>Select image layers or switch scope, then scan again.</EmptyState>}

      {rows && rows.length > 0 && (
        <div className="vss-list" aria-label="Images">
          {rows.map((row) => (
            <div className="vss-item" key={row.image.id} data-testid="alt-row">
              <input
                type="checkbox"
                aria-label={`Apply to ${row.image.name || row.image.filename || row.image.id}`}
                checked={row.selected}
                onChange={(e) => update(row.image.id, { selected: e.target.checked })}
              />
              <img className="vss-thumb" src={row.image.src} alt="" loading="lazy" />
              <div className="vss-stack" style={{ gap: 4, minWidth: 0 }}>
                <div className="vss-row vss-row--between">
                  <span className="vss-small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
                    {row.image.name || row.image.filename || "Image"}
                    {row.image.location && <span className="vss-muted"> · {row.image.location}</span>}
                  </span>
                  {row.result && (
                    <Badge tone={row.result.decorative ? "accent" : confidenceTone(row.result.confidence)} title={row.result.reasons.join("\n")}>
                      {row.result.decorative ? "Decorative" : row.result.source === "ai" ? "AI" : confidenceLabel(row.result.confidence)}
                    </Badge>
                  )}
                </div>
                {row.image.alt ? (
                  <span className="vss-help">Current: {row.image.alt}</span>
                ) : (
                  <span className="vss-help" style={{ color: "var(--vss-danger)" }}>
                    No alt text
                  </span>
                )}
                {row.result && (
                  <>
                    <TextArea
                      aria-label={`Alt text for ${row.image.name || row.image.id}`}
                      value={row.decorative ? "" : row.draft}
                      disabled={row.decorative}
                      rows={2}
                      maxLength={settings.altMaxLength + 50}
                      placeholder={row.decorative ? 'Decorative — alt=""' : "Describe this image"}
                      onChange={(e) => update(row.image.id, { draft: e.target.value, selected: true })}
                    />
                    <div className="vss-row vss-row--between">
                      <Checkbox
                        label="Decorative"
                        checked={row.decorative}
                        onChange={(e) => update(row.image.id, { decorative: e.target.checked, selected: true })}
                      />
                      <span className="vss-help">{row.decorative ? 0 : row.draft.length}/{settings.altMaxLength}</span>
                    </div>
                    {row.result.error && <span className="vss-error-text">AI fallback: {row.result.error}</span>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rows && rows.some((r) => r.result) && (
        <Button variant="primary" block onClick={apply} disabled={!stats.selected} loading={pending === "apply"} data-testid="apply-alt">
          Apply {stats.selected} change{stats.selected === 1 ? "" : "s"}
        </Button>
      )}
    </div>
  )
}
