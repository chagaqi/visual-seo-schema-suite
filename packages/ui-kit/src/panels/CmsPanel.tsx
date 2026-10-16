import { useRef, useState } from "react"
import {
  findDuplicateDescriptions,
  generateBulkAltText,
  generateMetaDescription,
  type CmsCollection,
  type CmsImageValue,
  type CmsItem,
  type CmsUpdate,
} from "@vss/core-engine"
import { Badge, Button, Card, EmptyState, Field, Progress, Select, Status, TextArea } from "../components.tsx"
import { useAction, useSuite } from "../context.tsx"

type Mode = "image-alt" | "meta"

interface PreviewRow {
  item: CmsItem
  current: string
  next: string
  selected: boolean
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
}

function isImageValue(v: unknown): v is CmsImageValue {
  return !!v && typeof v === "object" && "url" in (v as object)
}

export function CmsPanel() {
  const { adapter, settings, aiConfig, ai, metered } = useSuite()
  const { pending, run } = useAction()
  const [collections, setCollections] = useState<CmsCollection[] | null>(null)
  const [collectionId, setCollectionId] = useState("")
  const [items, setItems] = useState<CmsItem[]>([])
  const [mode, setMode] = useState<Mode>("image-alt")
  const [imageField, setImageField] = useState("")
  const [targetField, setTargetField] = useState("")
  const [sourceField, setSourceField] = useState("")
  const [rows, setRows] = useState<PreviewRow[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [status, setStatus] = useState("")
  const abortRef = useRef<AbortController | null>(null)

  const collection = collections?.find((c) => c.id === collectionId) ?? null
  const imageFields = collection?.fields.filter((f) => f.type === "image") ?? []
  const textFields = collection?.fields.filter((f) => f.type === "text" || f.type === "richtext") ?? []

  const loadCollections = () =>
    run("collections", async () => {
      const list = (await adapter.listCollections?.()) ?? []
      setCollections(list)
      setStatus(list.length ? "" : "No CMS collections found.")
    })

  const selectCollection = (id: string) =>
    run("items", async () => {
      setCollectionId(id)
      setRows(null)
      if (!id) return
      const c = collections?.find((x) => x.id === id)
      setImageField(c?.fields.find((f) => f.type === "image")?.id ?? "")
      const textual = c?.fields.filter((f) => f.type === "text" || f.type === "richtext") ?? []
      setTargetField(textual.find((f) => /meta|seo|description|summary|excerpt/i.test(f.name))?.id ?? textual[0]?.id ?? "")
      setSourceField(textual.find((f) => f.type === "richtext")?.id ?? textual[1]?.id ?? "")
      const list = (await adapter.listCollectionItems?.(id)) ?? []
      setItems(list)
      setStatus(`${list.length} items loaded.`)
    })

  const preview = () =>
    run("preview", async () => {
      if (!collection) return
      await metered("cms-bulk", async () => {
        if (mode === "image-alt") {
          const withImages = items.filter((i) => isImageValue(i.fieldData[imageField]))
          setProgress({ done: 0, total: withImages.length })
          const results = await generateBulkAltText(
            withImages.map((item) => {
              const img = item.fieldData[imageField] as CmsImageValue
              return {
                id: item.id,
                context: { src: img.url, existingAlt: img.alt, collectionItemTitle: item.title, brand: settings.brand || null, keywords: settings.keywords },
              }
            }),
            { maxLength: settings.altMaxLength, ai: aiConfig, aiScope: ai.scope, onProgress: (done, total) => setProgress({ done, total }) },
          )
          setRows(
            withImages.map((item, i) => {
              const current = (item.fieldData[imageField] as CmsImageValue).alt ?? ""
              const next = results[i]!.alt
              return { item, current, next, selected: next !== current && next.length > 0 }
            }),
          )
        } else {
          const next = items.map((item) => {
            const source = item.fieldData[sourceField]
            const body = typeof source === "string" ? stripHtml(source) : ""
            const r = generateMetaDescription({ title: item.title, bodyText: body, keywords: settings.keywords, brand: settings.brand || null, type: "article" })
            return r.description
          })
          const dupes = findDuplicateDescriptions(next).flat()
          setRows(
            items.map((item, i) => {
              const cur = item.fieldData[targetField]
              const current = typeof cur === "string" ? stripHtml(cur) : ""
              return { item, current, next: next[i]!, selected: next[i] !== current && !dupes.includes(i) }
            }),
          )
          if (dupes.length) setStatus(`${dupes.length} items produced duplicate descriptions and were left unselected.`)
        }
        setProgress(null)
      })
    })

  const apply = () =>
    run("apply", async () => {
      if (!collection || !rows || !adapter.updateCollectionItems) return
      const chosen = rows.filter((r) => r.selected)
      const updates: CmsUpdate[] = chosen.map((r) =>
        mode === "image-alt"
          ? { itemId: r.item.id, fieldId: imageField, kind: "image-alt", value: r.next }
          : { itemId: r.item.id, fieldId: targetField, kind: "text", value: r.next },
      )
      abortRef.current = new AbortController()
      setProgress({ done: 0, total: updates.length })
      try {
        const res = await adapter.updateCollectionItems(collection.id, updates, (done, total) => setProgress({ done, total }), abortRef.current.signal)
        const msg = `Updated ${res.updated} item${res.updated === 1 ? "" : "s"}${res.failed.length ? `, ${res.failed.length} failed` : ""}.`
        setStatus(msg)
        adapter.notify(msg, res.failed.length ? "warning" : "success")
        const failed = new Set(res.failed.map((f) => f.id))
        setRows((prev) => (prev ?? []).map((r) => (r.selected && !failed.has(r.item.id) ? { ...r, current: r.next, selected: false } : r)))
      } finally {
        abortRef.current = null
        setProgress(null)
      }
    })

  if (!adapter.capabilities.cms || !adapter.listCollections) {
    return <EmptyState>CMS bulk editing isn't available in this host.</EmptyState>
  }

  const selectedCount = rows?.filter((r) => r.selected).length ?? 0

  return (
    <div className="vss-stack" data-testid="panel-cms">
      <Card title="CMS bulk updater">
        <p className="vss-help" style={{ margin: 0 }}>
          Throttled, resumable batch updates with automatic back-off on rate limits (HTTP 429).
        </p>
        {!collections ? (
          <Button onClick={loadCollections} loading={pending === "collections"} data-testid="load-collections">
            Load collections
          </Button>
        ) : (
          <>
            <Field label="Collection">
              {(id) => (
                <Select
                  id={id}
                  value={collectionId}
                  placeholder="Choose a collection…"
                  onChange={(e) => void selectCollection(e.target.value)}
                  options={collections.map((c) => ({ value: c.id, label: `${c.name}${c.readOnly ? " (read-only)" : ""}` }))}
                />
              )}
            </Field>
            {collection && (
              <>
                <Field label="Task">
                  {(id) => (
                    <Select
                      id={id}
                      value={mode}
                      onChange={(e) => {
                        setMode(e.target.value as Mode)
                        setRows(null)
                      }}
                      options={[
                        { value: "image-alt", label: "Generate image alt text" },
                        { value: "meta", label: "Generate meta descriptions" },
                      ]}
                    />
                  )}
                </Field>
                {mode === "image-alt" ? (
                  <Field label="Image field">
                    {(id) => <Select id={id} value={imageField} onChange={(e) => setImageField(e.target.value)} options={imageFields.map((f) => ({ value: f.id, label: f.name }))} placeholder={imageFields.length ? undefined : "No image fields"} />}
                  </Field>
                ) : (
                  <div className="vss-grid-2">
                    <Field label="Write to">
                      {(id) => <Select id={id} value={targetField} onChange={(e) => setTargetField(e.target.value)} options={textFields.map((f) => ({ value: f.id, label: f.name }))} />}
                    </Field>
                    <Field label="Summarise from">
                      {(id) => <Select id={id} value={sourceField} onChange={(e) => setSourceField(e.target.value)} options={textFields.map((f) => ({ value: f.id, label: f.name }))} />}
                    </Field>
                  </div>
                )}
                <Button
                  variant="primary"
                  block
                  onClick={preview}
                  loading={pending === "preview"}
                  disabled={collection.readOnly || (mode === "image-alt" ? !imageField : !targetField || !sourceField)}
                  data-testid="preview-cms"
                >
                  Preview {items.length} items
                </Button>
              </>
            )}
          </>
        )}
      </Card>

      {progress && (
        <div className="vss-stack" style={{ gap: 4 }}>
          <Progress value={progress.done} max={progress.total} label="CMS progress" />
          <div className="vss-row vss-row--between">
            <span className="vss-help">
              {progress.done}/{progress.total}
            </span>
            {abortRef.current && (
              <Button size="sm" variant="danger" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
      <Status>{status}</Status>

      {rows && (
        <>
          <div className="vss-list" aria-label="CMS preview">
            {rows.map((r) => (
              <div key={r.item.id} className="vss-card" data-testid="cms-row" style={{ gap: 4 }}>
                <div className="vss-row vss-row--between">
                  <label className="vss-check">
                    <input
                      type="checkbox"
                      checked={r.selected}
                      onChange={(e) => setRows((prev) => (prev ?? []).map((x) => (x.item.id === r.item.id ? { ...x, selected: e.target.checked } : x)))}
                    />
                    <strong>{r.item.title}</strong>
                  </label>
                  {r.current === r.next ? <Badge tone="success">Unchanged</Badge> : <Badge tone="accent">New</Badge>}
                </div>
                {r.current && <span className="vss-help">Current: {r.current}</span>}
                <TextArea
                  aria-label={`New value for ${r.item.title}`}
                  rows={2}
                  value={r.next}
                  onChange={(e) => setRows((prev) => (prev ?? []).map((x) => (x.item.id === r.item.id ? { ...x, next: e.target.value, selected: true } : x)))}
                />
              </div>
            ))}
          </div>
          <Button variant="primary" block onClick={apply} disabled={!selectedCount} loading={pending === "apply"} data-testid="apply-cms">
            Update {selectedCount} item{selectedCount === 1 ? "" : "s"}
          </Button>
        </>
      )}
    </div>
  )
}
