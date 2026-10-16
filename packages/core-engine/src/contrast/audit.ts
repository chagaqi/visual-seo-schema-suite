import { generateAltText, lintAltText } from "../alt-text/generate.ts"
import { analyzeMetaDescription } from "../meta/generate.ts"
import { squish } from "../text/util.ts"
import { evaluateContrast, requiredRatio, suggestAccessibleColor, type WcagLevel } from "./wcag.ts"

/** Host-agnostic description of what is on the canvas/page. Adapters map Framer/Webflow nodes to this. */
export type AuditNode =
  | {
      kind: "text"
      id: string
      name?: string | null
      text: string
      color: string
      /** Effective background behind the text; null when unknown (gradient/image). */
      background?: string | null
      fontSizePx?: number
      fontWeight?: number
      tag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "li" | "label" | string
    }
  | {
      kind: "image"
      id: string
      name?: string | null
      src?: string | null
      alt?: string | null
      decorative?: boolean
      width?: number | null
      height?: number | null
      nearbyText?: string | null
      linkHref?: string | null
    }
  | {
      kind: "link" | "button"
      id: string
      name?: string | null
      text?: string | null
      ariaLabel?: string | null
      href?: string | null
      width?: number | null
      height?: number | null
      color?: string | null
      background?: string | null
      fontSizePx?: number
      fontWeight?: number
    }
  | {
      kind: "ui"
      id: string
      name?: string | null
      /** e.g. icon fill, input border, focus ring */
      color: string
      background: string
    }

export interface PageMeta {
  title?: string | null
  description?: string | null
  lang?: string | null
  url?: string | null
}

export interface AuditInput {
  nodes: AuditNode[]
  page?: PageMeta
  level?: WcagLevel
  keywords?: string[]
}

export type Severity = "critical" | "serious" | "moderate" | "minor"

export type AuditFix =
  | { type: "color"; property: "color" | "background"; value: string; ratio: number }
  | { type: "alt"; value: string; decorative: boolean }
  | { type: "aria-label"; value: string }
  | { type: "manual"; hint: string }

export interface AuditIssue {
  id: string
  rule:
    | "text-contrast"
    | "non-text-contrast"
    | "image-alt"
    | "link-name"
    | "generic-link-text"
    | "target-size"
    | "heading-order"
    | "multiple-h1"
    | "missing-h1"
    | "small-text"
    | "page-title"
    | "html-lang"
    | "meta-description"
    | "contrast-unknown"
  /** WCAG success criterion ("1.4.3") or "SEO" / "best-practice". */
  criterion: string
  level: "A" | "AA" | "AAA" | "SEO" | "BP"
  severity: Severity
  nodeId?: string
  nodeName?: string | null
  message: string
  fix?: AuditFix
}

export interface AuditReport {
  issues: AuditIssue[]
  score: number
  checks: number
  summary: Record<Severity, number>
  level: WcagLevel
}

const GENERIC_LINK = /^(click here|here|read more|more|learn more|link|this|details|continue|go|tap here)$/i
const WEIGHT: Record<Severity, number> = { critical: 10, serious: 5, moderate: 2, minor: 0.5 }

function headingLevel(tag: string | undefined): number | null {
  const m = tag?.match(/^h([1-6])$/i)
  return m ? Number(m[1]) : null
}

/** Run the full WCAG 2.2 AA/AAA + SEO audit over host nodes. Pure & synchronous. */
export function auditAccessibility(input: AuditInput): AuditReport {
  const level = input.level ?? "AA"
  const issues: AuditIssue[] = []
  let checks = 0
  let seq = 0
  const push = (issue: Omit<AuditIssue, "id">) => issues.push({ id: `${issue.rule}-${++seq}`, ...issue })

  const headings: Array<{ level: number; id: string; name?: string | null }> = []

  for (const node of input.nodes) {
    switch (node.kind) {
      case "text": {
        if (!squish(node.text)) break
        const h = headingLevel(node.tag)
        if (h) headings.push({ level: h, id: node.id, name: node.name })
        checks++
        if (node.fontSizePx !== undefined && node.fontSizePx < 12) {
          push({
            rule: "small-text",
            criterion: "best-practice",
            level: "BP",
            severity: "minor",
            nodeId: node.id,
            nodeName: node.name,
            message: `${node.fontSizePx}px text is hard to read; use at least 12px (16px for body copy).`,
          })
        }
        if (!node.background) {
          push({
            rule: "contrast-unknown",
            criterion: "1.4.3",
            level: "AA",
            severity: "minor",
            nodeId: node.id,
            nodeName: node.name,
            message: "Text sits on an image or gradient — verify contrast manually.",
            fix: { type: "manual", hint: "Add a solid overlay or text shadow behind the text." },
          })
          break
        }
        let result
        try {
          result = evaluateContrast(node.color, node.background, { fontSizePx: node.fontSizePx, fontWeight: node.fontWeight })
        } catch {
          break
        }
        const passes = level === "AAA" ? result.aaa : result.aa
        if (!passes) {
          const target = requiredRatio(level, result.largeText)
          const suggestion = suggestAccessibleColor(node.color, node.background, target)[0]
          const failsAA = !result.aa
          push({
            rule: "text-contrast",
            criterion: level === "AAA" && !failsAA ? "1.4.6" : "1.4.3",
            level: level === "AAA" && !failsAA ? "AAA" : "AA",
            severity: failsAA ? (result.ratio < 3 ? "critical" : "serious") : "moderate",
            nodeId: node.id,
            nodeName: node.name,
            message: `Contrast ${result.displayRatio}:1 — needs ${target}:1 for ${result.largeText ? "large" : "normal"} text (${level}).`,
            ...(suggestion
              ? { fix: { type: "color" as const, property: "color" as const, value: suggestion.color, ratio: suggestion.ratio } }
              : {}),
          })
        }
        break
      }
      case "image": {
        checks++
        const issuesForAlt = lintAltText(node.alt, { nearbyText: node.nearbyText, decorative: node.decorative })
        if (issuesForAlt.length === 0) break
        const worst = issuesForAlt.some((i) => i.severity === "error") ? "serious" : "minor"
        const generated = generateAltText(
          {
            src: node.src ?? undefined,
            layerName: node.name,
            nearbyText: node.nearbyText,
            width: node.width,
            height: node.height,
            linkHref: node.linkHref,
          },
          { overwrite: true },
        )
        push({
          rule: "image-alt",
          criterion: "1.1.1",
          level: "A",
          severity: node.linkHref && worst === "serious" ? "critical" : worst,
          nodeId: node.id,
          nodeName: node.name,
          message: issuesForAlt.map((i) => i.message).join(" "),
          fix: { type: "alt", value: generated.alt, decorative: generated.decorative },
        })
        break
      }
      case "link":
      case "button": {
        checks++
        const label = squish(node.ariaLabel || node.text || "")
        if (!label) {
          push({
            rule: "link-name",
            criterion: node.kind === "link" ? "2.4.4" : "4.1.2",
            level: "A",
            severity: "serious",
            nodeId: node.id,
            nodeName: node.name,
            message: `${node.kind === "link" ? "Link" : "Button"} has no accessible name.`,
            fix: { type: "aria-label", value: node.name && !/^(link|button)\s*\d*$/i.test(node.name) ? node.name : "Describe the action" },
          })
        } else if (node.kind === "link" && GENERIC_LINK.test(label)) {
          push({
            rule: "generic-link-text",
            criterion: "2.4.4",
            level: "A",
            severity: "moderate",
            nodeId: node.id,
            nodeName: node.name,
            message: `"${label}" doesn't describe where the link goes.`,
            fix: { type: "manual", hint: 'Use descriptive text like "Read the pricing guide".' },
          })
        }
        const minTarget = level === "AAA" ? 44 : 24
        if (node.width && node.height && (node.width < minTarget || node.height < minTarget)) {
          push({
            rule: "target-size",
            criterion: level === "AAA" ? "2.5.5" : "2.5.8",
            level: level === "AAA" ? "AAA" : "AA",
            severity: "moderate",
            nodeId: node.id,
            nodeName: node.name,
            message: `Target is ${Math.round(node.width)}×${Math.round(node.height)}px; minimum is ${minTarget}×${minTarget}px.`,
            fix: { type: "manual", hint: `Increase padding to reach ${minTarget}px.` },
          })
        }
        if (node.color && node.background && label) {
          try {
            const r = evaluateContrast(node.color, node.background, { fontSizePx: node.fontSizePx, fontWeight: node.fontWeight })
            if (!r.aa) {
              const target = requiredRatio("AA", r.largeText)
              const suggestion = suggestAccessibleColor(node.color, node.background, target)[0]
              push({
                rule: "text-contrast",
                criterion: "1.4.3",
                level: "AA",
                severity: r.ratio < 3 ? "critical" : "serious",
                nodeId: node.id,
                nodeName: node.name,
                message: `${node.kind === "link" ? "Link" : "Button"} label contrast ${r.displayRatio}:1 — needs ${target}:1.`,
                ...(suggestion ? { fix: { type: "color" as const, property: "color" as const, value: suggestion.color, ratio: suggestion.ratio } } : {}),
              })
            }
          } catch {
            /* unparseable colors are skipped */
          }
        }
        break
      }
      case "ui": {
        checks++
        try {
          const r = evaluateContrast(node.color, node.background)
          if (!r.nonText) {
            const suggestion = suggestAccessibleColor(node.color, node.background, 3)[0]
            push({
              rule: "non-text-contrast",
              criterion: "1.4.11",
              level: "AA",
              severity: "serious",
              nodeId: node.id,
              nodeName: node.name,
              message: `UI element contrast ${r.displayRatio}:1 — needs 3:1.`,
              ...(suggestion ? { fix: { type: "color" as const, property: "color" as const, value: suggestion.color, ratio: suggestion.ratio } } : {}),
            })
          }
        } catch {
          /* skip */
        }
        break
      }
    }
  }

  // Document structure
  if (headings.length > 0) {
    checks++
    const h1s = headings.filter((h) => h.level === 1)
    if (h1s.length === 0) {
      push({ rule: "missing-h1", criterion: "best-practice", level: "BP", severity: "moderate", message: "Page has no H1 heading." })
    } else if (h1s.length > 1) {
      push({
        rule: "multiple-h1",
        criterion: "best-practice",
        level: "BP",
        severity: "minor",
        nodeId: h1s[1]!.id,
        nodeName: h1s[1]!.name,
        message: `Page has ${h1s.length} H1 headings; use one.`,
      })
    }
    for (let i = 1; i < headings.length; i++) {
      const prev = headings[i - 1]!
      const cur = headings[i]!
      if (cur.level > prev.level + 1) {
        push({
          rule: "heading-order",
          criterion: "1.3.1",
          level: "A",
          severity: "moderate",
          nodeId: cur.id,
          nodeName: cur.name,
          message: `Heading jumps from H${prev.level} to H${cur.level}.`,
          fix: { type: "manual", hint: `Use H${prev.level + 1} here, or restyle with CSS instead.` },
        })
      }
    }
  }

  if (input.page) {
    const { title, description, lang } = input.page
    checks += 3
    if (title !== undefined && !squish(title ?? "")) {
      push({ rule: "page-title", criterion: "2.4.2", level: "A", severity: "serious", message: "Page has no title." })
    }
    if (lang !== undefined && !squish(lang ?? "")) {
      push({ rule: "html-lang", criterion: "3.1.1", level: "A", severity: "serious", message: "Page language (lang) is not set." })
    }
    if (description !== undefined) {
      const meta = analyzeMetaDescription(description, { keywords: input.keywords, title })
      for (const mi of meta.issues.filter((i) => i.severity !== "info")) {
        push({
          rule: "meta-description",
          criterion: "SEO",
          level: "SEO",
          severity: mi.severity === "error" ? "moderate" : "minor",
          message: mi.message,
        })
      }
    }
  }

  const summary: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const i of issues) summary[i.severity]++
  const penalty = issues.reduce((sum, i) => sum + WEIGHT[i.severity], 0)
  const score = checks === 0 ? 100 : Math.max(0, Math.round(100 - (penalty / Math.max(checks, 1)) * 10))
  const order: Severity[] = ["critical", "serious", "moderate", "minor"]
  issues.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  return { issues, score, checks, summary, level }
}

/** Contrast matrix across a palette (e.g. Framer color styles) — every fg/bg pair. */
export function paletteMatrix(colors: Array<{ name: string; value: string }>) {
  return colors.flatMap((fg) =>
    colors
      .filter((bg) => bg !== fg)
      .map((bg) => {
        try {
          const r = evaluateContrast(fg.value, bg.value)
          return { foreground: fg.name, background: bg.name, ratio: r.ratio, aa: r.aa, aaa: r.aaa, largeAA: r.ratio >= 3 }
        } catch {
          return null
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  )
}
