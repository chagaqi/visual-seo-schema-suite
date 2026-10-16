import { useEffect, useState } from "react"
import {
  SNIPPET_PIXEL_LIMIT,
  analyzeMetaDescription,
  estimatePixelWidth,
  generateMetaDescription,
  generateSeoTitle,
  type PageInfo,
  type PageType,
} from "@vss/core-engine"
import { Badge, Button, Card, Field, Select, Status, TextArea, TextInput } from "../components.tsx"
import { copyToClipboard, useAction, useSuite } from "../context.tsx"

const PAGE_TYPES: Array<{ value: PageType; label: string }> = [
  { value: "page", label: "Page" },
  { value: "home", label: "Home page" },
  { value: "article", label: "Article / blog" },
  { value: "product", label: "Product" },
  { value: "collection", label: "Collection / category" },
  { value: "local", label: "Local business" },
]

function hostFromUrl(url: string | null | undefined): string {
  if (!url) return "example.com"
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname === "/" ? "" : u.pathname.replace(/\//g, " › ")}`
  } catch {
    return url
  }
}

export function MetaPanel() {
  const { adapter, settings, metered } = useSuite()
  const { pending, run } = useAction()
  const [page, setPage] = useState<PageInfo | null>(null)
  const [keywords, setKeywords] = useState("")
  const [cta, setCta] = useState("")
  const [type, setType] = useState<PageType>("page")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [generated, setGenerated] = useState(false)
  const [status, setStatus] = useState("")

  useEffect(() => {
    setKeywords(settings.keywords.join(", "))
  }, [settings.keywords])

  const load = () =>
    run("load", async () => {
      const info = await adapter.getPageInfo()
      setPage(info)
      setTitle(info.title)
      setDescription(info.description ?? "")
      setGenerated(false)
    })

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter])

  const kwList = keywords.split(",").map((k) => k.trim()).filter(Boolean)

  const generate = () =>
    run("generate", async () => {
      if (!page) return
      await metered("meta", async () => {
        const content = {
          title: page.title,
          headings: page.headings,
          bodyText: page.bodyText,
          keywords: kwList,
          brand: settings.brand || page.brand || null,
          cta: cta || null,
          type,
          url: page.url,
        }
        const meta = generateMetaDescription(content)
        const seo = generateSeoTitle(content)
        setDescription(meta.description)
        setTitle(seo.title)
        setGenerated(true)
        setStatus(`Generated a ${meta.length}-character description (${meta.strategy}).`)
      })
    })

  const apply = () =>
    run("apply", async () => {
      if (adapter.setPageMeta) {
        await adapter.setPageMeta({ title, description })
        adapter.notify("Page title & description updated", "success")
        setStatus("Saved to page settings.")
      }
    })

  const analysis = analyzeMetaDescription(description, { keywords: kwList, title })
  const width = estimatePixelWidth(description)

  return (
    <div className="vss-stack" data-testid="panel-meta">
      <Card
        title="Meta description"
        actions={
          <Button size="sm" variant="ghost" onClick={load} loading={pending === "load"}>
            Reload page
          </Button>
        }
      >
        {page && (
          <p className="vss-help" style={{ margin: 0 }}>
            Analysing “{page.title || "Untitled page"}” · {page.headings.length} headings · {page.bodyText.split(/\s+/).filter(Boolean).length} words
          </p>
        )}
        <div className="vss-grid-2">
          <Field label="Target keywords" help="Comma separated; first is primary.">
            {(id, d) => <TextInput id={id} aria-describedby={d} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="pour-over coffee" />}
          </Field>
          <Field label="Page type">
            {(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value as PageType)} options={PAGE_TYPES} />}
          </Field>
        </div>
        <Field label="Call to action (optional)">
          {(id) => <TextInput id={id} value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Book a free tasting" />}
        </Field>
        <Button variant="primary" block onClick={generate} disabled={!page} loading={pending === "generate"} data-testid="generate-meta">
          {generated ? "Regenerate" : "Generate title & description"}
        </Button>
      </Card>

      <Field label="SEO title" counter={<span className="vss-help">{title.length}/60</span>}>
        {(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field
        label="Meta description"
        counter={
          <span className="vss-help" data-testid="meta-count">
            {description.length}/155 · ≈{width}px
          </span>
        }
      >
        {(id) => <TextArea id={id} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="meta-description" />}
      </Field>
      <div className="vss-progress" aria-hidden="true">
        <div style={{ width: `${Math.min(100, (width / SNIPPET_PIXEL_LIMIT) * 100)}%`, background: width > SNIPPET_PIXEL_LIMIT ? "var(--vss-danger)" : undefined }} />
      </div>

      <div className="vss-row">
        <Badge tone={analysis.score >= 85 ? "success" : analysis.score >= 50 ? "warning" : "danger"}>Score {analysis.score}</Badge>
        {analysis.issues.map((i) => (
          <Badge key={i.code} tone={i.severity === "error" ? "danger" : i.severity === "warning" ? "warning" : "neutral"} title={i.message}>
            {i.message}
          </Badge>
        ))}
      </div>

      <div className="vss-serp" aria-label="Google search preview">
        <div className="vss-serp-url">{hostFromUrl(page?.url)}</div>
        <div className="vss-serp-title">{title || "Page title"}</div>
        <div className="vss-serp-desc">{description || "Your meta description will appear here."}</div>
      </div>

      <div className="vss-row">
        {adapter.capabilities.setPageMeta && (
          <Button variant="primary" onClick={apply} disabled={!description} loading={pending === "apply"} data-testid="apply-meta">
            Save to page
          </Button>
        )}
        <Button
          onClick={async () => {
            const ok = await copyToClipboard(description)
            adapter.notify(ok ? "Description copied" : "Copy failed — select and copy manually", ok ? "success" : "warning")
          }}
          disabled={!description}
        >
          Copy
        </Button>
      </div>
      {!adapter.capabilities.setPageMeta && (
        <p className="vss-help" style={{ margin: 0 }}>
          {adapter.displayName} doesn't let plugins edit page SEO settings yet — paste into Page Settings › SEO, or use the CMS tab for collection pages.
        </p>
      )}
      <Status>{status}</Status>
    </div>
  )
}
