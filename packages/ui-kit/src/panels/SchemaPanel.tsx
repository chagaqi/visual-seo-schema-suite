import { useEffect, useMemo, useState } from "react"
import {
  SCHEMA_DEFINITIONS,
  SCHEMA_TYPES,
  buildJsonLd,
  emptyFormData,
  extractFaqPairs,
  jsonLdToFormData,
  toScriptTag,
  validateJsonLd,
  type FieldDef,
  type JsonLdObject,
  type SchemaFormData,
  type SchemaFormValue,
  type SchemaIssue,
  type SchemaType,
  type StructuredDataTarget,
} from "@vss/core-engine"
import { Badge, Button, Card, EmptyState, Field, Select, Status, TextArea, TextInput } from "../components.tsx"
import { copyToClipboard, useAction, useSuite } from "../context.tsx"

const SITE_WIDE_TYPES: SchemaType[] = ["LocalBusiness", "SoftwareApplication"]

/** Map validator paths ("mainEntity[1].acceptedAnswer.text") onto form keys. */
function issuesByField(issues: SchemaIssue[], fields: FieldDef[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const issue of issues) {
    const listField = fields.find((f) => f.type === "list" && issue.path.startsWith(`${f.key}[`))
    let key = issue.path
    if (listField) {
      const m = issue.path.match(/^([^[]+)\[(\d+)\]\.?(.*)$/)
      if (m) key = `${m[1]}[${m[2]}].${m[3]}`
    }
    if (!map.has(key)) map.set(key, issue.message)
  }
  return map
}

function schemaTypeOf(obj: JsonLdObject): SchemaType | null {
  const t = String(obj["@type"] ?? "")
  if (SCHEMA_TYPES.includes(t as SchemaType)) return t as SchemaType
  for (const type of SCHEMA_TYPES) {
    const options = SCHEMA_DEFINITIONS[type].fields.find((f) => f.key === "@type")?.options ?? []
    if (options.some((o) => o.value === t)) return type
  }
  return null
}

function labelOf(obj: JsonLdObject): string {
  return String(obj.name ?? obj.headline ?? (Array.isArray(obj.mainEntity) ? `${obj.mainEntity.length} questions` : obj["@type"]))
}

function FieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldDef
  value: SchemaFormValue
  error?: string
  onChange: (v: SchemaFormValue) => void
}) {
  const common = { "aria-invalid": error ? true : undefined } as const
  return (
    <Field label={field.label} help={field.help} error={error ?? null} required={field.required} recommended={field.recommended}>
      {(id, describedBy) => {
        const props = { id, "aria-describedby": describedBy, ...common }
        switch (field.type) {
          case "textarea":
            return <TextArea {...props} rows={3} value={String(value ?? "")} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />
          case "select":
            return (
              <Select
                {...props}
                value={String(value ?? "")}
                onChange={(e) => onChange(e.target.value)}
                options={field.options ?? []}
                placeholder={field.defaultValue === undefined ? "—" : undefined}
              />
            )
          case "multiselect": {
            const selected = Array.isArray(value) ? (value as string[]) : []
            return (
              <div className="vss-chips" id={id} role="group" aria-label={field.label}>
                {(field.options ?? []).map((o) => {
                  const on = selected.includes(o.value)
                  return (
                    <button
                      key={o.value}
                      type="button"
                      className="vss-chip"
                      aria-pressed={on}
                      onClick={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                    >
                      {o.label.slice(0, 3)}
                    </button>
                  )
                })}
              </div>
            )
          }
          case "urlList":
            return (
              <TextArea
                {...props}
                rows={2}
                value={Array.isArray(value) ? (value as string[]).join("\n") : String(value ?? "")}
                onChange={(e) => onChange(e.target.value.split("\n"))}
                placeholder="https://"
              />
            )
          default: {
            const type = field.type === "url" ? "url" : field.type === "email" ? "email" : field.type === "tel" ? "tel" : field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "time" ? "time" : "text"
            return (
              <TextInput
                {...props}
                type={type}
                value={value === undefined || value === null ? "" : String(value)}
                placeholder={field.placeholder}
                maxLength={field.maxLength}
                min={field.min}
                max={field.max}
                step={field.step}
                onChange={(e) => onChange(field.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
              />
            )
          }
        }
      }}
    </Field>
  )
}

export function SchemaPanel() {
  const { adapter, metered } = useSuite()
  const { pending, run } = useAction()
  const [type, setType] = useState<SchemaType>("LocalBusiness")
  const [data, setData] = useState<SchemaFormData>(() => emptyFormData("LocalBusiness"))
  const [target, setTarget] = useState<StructuredDataTarget>("site")
  const [saved, setSaved] = useState<JsonLdObject[]>([])
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [paste, setPaste] = useState("")
  const [status, setStatus] = useState("")
  const def = SCHEMA_DEFINITIONS[type]

  const loadSaved = (t: StructuredDataTarget) =>
    run("saved", async () => {
      setSaved(await adapter.getStructuredData(t))
    })

  useEffect(() => {
    void loadSaved(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, target])

  const chooseType = (t: SchemaType) => {
    setType(t)
    setData(emptyFormData(t))
    setEditIndex(null)
    setTarget(SITE_WIDE_TYPES.includes(t) ? "site" : "page")
  }

  const jsonld = useMemo(() => buildJsonLd(type, data), [type, data])
  const validation = useMemo(() => validateJsonLd(jsonld), [jsonld])
  const errors = useMemo(() => issuesByField([...validation.errors], def.fields), [validation, def.fields])
  const pasteResult = useMemo(() => (paste.trim() ? validateJsonLd(paste) : null), [paste])

  const set = (key: string, value: SchemaFormValue) => setData((d) => ({ ...d, [key]: value }))

  const save = () =>
    run("save", async () => {
      if (!validation.valid) {
        adapter.notify("Fix the highlighted errors first", "warning")
        return
      }
      await metered("schema", async () => {
        const next = [...saved]
        if (editIndex !== null) next[editIndex] = jsonld
        else next.push(jsonld)
        const res = await adapter.saveStructuredData(next, target)
        setSaved(next)
        setEditIndex(next.indexOf(jsonld))
        setStatus(res.message)
        adapter.notify(res.message, "success")
      })
    })

  const remove = (index: number) =>
    run("save", async () => {
      const next = saved.filter((_, i) => i !== index)
      const res = await adapter.saveStructuredData(next, target)
      setSaved(next)
      if (editIndex === index) setEditIndex(null)
      setStatus(res.message)
    })

  const autofillFaq = () =>
    run("faq", async () => {
      const page = await adapter.getPageInfo()
      const pairs = extractFaqPairs(page.sections ?? [])
      if (!pairs.length) {
        adapter.notify("No question-style headings found on this page", "info")
        return
      }
      set("mainEntity", pairs)
      setStatus(`Imported ${pairs.length} questions from the page.`)
    })

  const renderField = (field: FieldDef) => {
    if (field.type !== "list") {
      return <FieldInput key={field.key} field={field} value={data[field.key]} error={errors.get(field.key)} onChange={(v) => set(field.key, v)} />
    }
    const items = (Array.isArray(data[field.key]) ? data[field.key] : []) as SchemaFormData[]
    const updateItem = (i: number, key: string, v: SchemaFormValue) => set(field.key, items.map((it, idx) => (idx === i ? { ...it, [key]: v } : it)))
    const listError = errors.get(field.key)
    return (
      <fieldset key={field.key} className="vss-listgroup" style={{ margin: 0 }}>
        <legend className="vss-label">
          {field.label}
          {field.required && <span className="vss-required"> *</span>}
        </legend>
        {listError && <span className="vss-error-text">{listError}</span>}
        {items.map((item, i) => (
          <div key={i} className="vss-card" data-testid={`list-item-${field.key}`}>
            <div className="vss-row vss-row--between">
              <span className="vss-small vss-muted">
                {field.itemLabel} {i + 1}
              </span>
              <Button size="sm" variant="danger" onClick={() => set(field.key, items.filter((_, idx) => idx !== i))} aria-label={`Remove ${field.itemLabel} ${i + 1}`}>
                Remove
              </Button>
            </div>
            {(field.fields ?? []).map((sub) => (
              <FieldInput
                key={sub.key}
                field={sub}
                value={item[sub.key] ?? sub.defaultValue as SchemaFormValue}
                error={errors.get(`${field.key}[${i}].${sub.key}`)}
                onChange={(v) => updateItem(i, sub.key, v)}
              />
            ))}
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const blank: SchemaFormData = {}
            for (const sub of field.fields ?? []) if (sub.defaultValue !== undefined) blank[sub.key] = sub.defaultValue as SchemaFormValue
            set(field.key, [...items, blank])
          }}
        >
          + Add {field.itemLabel?.toLowerCase()}
        </Button>
      </fieldset>
    )
  }

  return (
    <div className="vss-stack" data-testid="panel-schema">
      <Card title="Structured data builder">
        <div className="vss-tiles" role="group" aria-label="Schema type">
          {SCHEMA_TYPES.map((t) => (
            <button key={t} type="button" className="vss-tile" aria-pressed={t === type} onClick={() => chooseType(t)} data-testid={`schema-type-${t}`}>
              <strong className="vss-small">{SCHEMA_DEFINITIONS[t].label}</strong>
            </button>
          ))}
        </div>
        <p className="vss-help" style={{ margin: 0 }}>
          {def.description}{" "}
          <a href={def.docsUrl} target="_blank" rel="noreferrer" style={{ color: "var(--vss-accent)" }}>
            Google docs
          </a>
        </p>
        <div className="vss-row">
          <Button size="sm" variant="ghost" onClick={() => setData({ ...emptyFormData(type), ...def.example })} data-testid="load-example">
            Load example
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setData(emptyFormData(type))}>
            Clear
          </Button>
          {type === "FAQPage" && (
            <Button size="sm" variant="ghost" onClick={autofillFaq} loading={pending === "faq"}>
              Import from page
            </Button>
          )}
        </div>
      </Card>

      <div className="vss-stack">{def.fields.map(renderField)}</div>

      <Card title="Live JSON-LD">
        <div className="vss-row" data-testid="schema-validation">
          {validation.valid ? <Badge tone="success">✓ Valid</Badge> : <Badge tone="danger">{validation.errors.length} error{validation.errors.length === 1 ? "" : "s"}</Badge>}
          {validation.warnings.length > 0 && <Badge tone="warning">{validation.warnings.length} warning{validation.warnings.length === 1 ? "" : "s"}</Badge>}
          {validation.richResultEligible && <Badge tone="accent">Rich result eligible</Badge>}
        </div>
        {validation.warnings.length > 0 && (
          <ul className="vss-help" style={{ margin: 0, paddingLeft: 16 }}>
            {validation.warnings.slice(0, 6).map((w) => (
              <li key={w.path + w.message}>{w.message}</li>
            ))}
          </ul>
        )}
        <pre className="vss-code" data-testid="schema-json" tabIndex={0} role="region" aria-label="Generated JSON-LD">{JSON.stringify(jsonld, null, 2)}</pre>
        <Field label="Apply to">
          {(id) => (
            <Select
              id={id}
              value={target}
              onChange={(e) => setTarget(e.target.value as StructuredDataTarget)}
              options={[
                { value: "site", label: "Whole site (all pages)" },
                { value: "page", label: "Current page only" },
              ]}
            />
          )}
        </Field>
        <div className="vss-row">
          <Button variant="primary" onClick={save} loading={pending === "save"} disabled={!validation.valid} data-testid="save-schema">
            {editIndex !== null ? "Update markup" : target === "site" ? "Add to site head" : "Add to page"}
          </Button>
          <Button
            onClick={async () => {
              const ok = await copyToClipboard(toScriptTag(jsonld, { pretty: true }))
              adapter.notify(ok ? "<script> tag copied" : "Copy failed", ok ? "success" : "warning")
            }}
          >
            Copy &lt;script&gt;
          </Button>
        </div>
        <Status>{status}</Status>
      </Card>

      <Card title={`Installed markup (${target === "site" ? "site" : "this page"})`}>
        {saved.length === 0 ? (
          <EmptyState>Nothing installed yet.</EmptyState>
        ) : (
          <div className="vss-list" data-testid="saved-schemas">
            {saved.map((obj, i) => {
              const t = schemaTypeOf(obj)
              const v = validateJsonLd(obj)
              return (
                <div key={i} className="vss-row vss-row--between vss-card" style={{ flexDirection: "row" }}>
                  <span className="vss-small">
                    <strong>{String(obj["@type"])}</strong> · {labelOf(obj)} {v.valid ? <Badge tone="success">valid</Badge> : <Badge tone="danger">invalid</Badge>}
                  </span>
                  <div className="vss-row" style={{ gap: 4 }}>
                    {t && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setType(t)
                          setData({ ...emptyFormData(t), ...jsonLdToFormData(t, obj) })
                          setEditIndex(i)
                        }}
                      >
                        Edit
                      </Button>
                    )}
                    <Button size="sm" variant="danger" onClick={() => remove(i)}>
                      Remove
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card title="Validate existing JSON-LD">
        <TextArea aria-label="Paste JSON-LD to validate" rows={3} className="vss-textarea vss-mono" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{"@context":"https://schema.org", …}' />
        {pasteResult && (
          <div className="vss-stack" style={{ gap: 4 }} data-testid="paste-result">
            <div className="vss-row">
              {pasteResult.valid ? <Badge tone="success">✓ Valid {pasteResult.types.join(", ")}</Badge> : <Badge tone="danger">Invalid</Badge>}
              {pasteResult.richResultEligible && <Badge tone="accent">Rich result eligible</Badge>}
            </div>
            {[...pasteResult.errors, ...pasteResult.warnings].slice(0, 8).map((i) => (
              <span key={i.path + i.message} className={i.severity === "error" ? "vss-error-text" : "vss-help"}>
                {i.path ? `${i.path}: ` : ""}
                {i.message}
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

