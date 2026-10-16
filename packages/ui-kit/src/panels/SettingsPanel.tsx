import { useEffect, useState } from "react"
import { AI_MODEL_CHOICES, DEFAULT_AI_MODELS, FREE_LIMIT } from "@vss/core-engine"
import { Badge, Button, Card, Field, Progress, Select, Status, TextInput } from "../components.tsx"
import { useAction, useSuite, type AiSettings } from "../context.tsx"

export function UsageMeter() {
  const { usage } = useSuite()
  if (!usage) return null
  if (usage.plan === "pro")
    return (
      <span className="vss-usage" data-testid="usage">
        <Badge tone="accent">Pro</Badge>
      </span>
    )
  const used = usage.limit - (usage.remaining ?? 0)
  return (
    <span className="vss-usage" data-testid="usage" title={usage.offline ? "Offline — counting locally" : undefined}>
      {usage.remaining ?? 0}/{usage.limit} free
      <span style={{ width: 40 }}>
        <Progress value={used} max={usage.limit} label="Free credits used" />
      </span>
    </span>
  )
}

export function LicenseForm({ onActivated }: { onActivated?: () => void }) {
  const { license, adapter, refreshUsage, checkoutUrl, usage } = useSuite()
  const { pending, run } = useAction()
  const [key, setKey] = useState("")
  const [message, setMessage] = useState("")

  if (!license) return <p className="vss-help">Licensing is disabled in this build.</p>

  const activate = () =>
    run("activate", async () => {
      const res = await license.activate(key)
      setMessage(res.valid ? "License activated — unlimited usage unlocked." : res.message ?? "That key isn't valid.")
      if (res.valid) {
        adapter.notify("Pro unlocked", "success")
        await refreshUsage()
        onActivated?.()
      }
    })

  return (
    <div className="vss-stack">
      <Field label="License key" help="Sent only to our license server for verification with Polar.sh.">
        {(id, d) => <TextInput id={id} aria-describedby={d} value={key} onChange={(e) => setKey(e.target.value)} placeholder="VSS-XXXX-XXXX-XXXX" data-testid="license-key" />}
      </Field>
      <div className="vss-row">
        <Button variant="primary" onClick={activate} disabled={!key.trim()} loading={pending === "activate"} data-testid="activate-license">
          Activate
        </Button>
        <a className="vss-btn vss-btn--ghost" href={usage?.checkoutUrl || checkoutUrl} target="_blank" rel="noreferrer">
          Buy Pro
        </a>
      </div>
      <Status>{message}</Status>
    </div>
  )
}

export function SettingsPanel() {
  const { settings, updateSettings, ai, updateAi, usage } = useSuite()
  const [brand, setBrand] = useState(settings.brand)
  const [keywords, setKeywords] = useState(settings.keywords.join(", "))
  const [aiDraft, setAiDraft] = useState<AiSettings>(ai)
  const [saved, setSaved] = useState("")

  useEffect(() => {
    setBrand(settings.brand)
    setKeywords(settings.keywords.join(", "))
  }, [settings])
  useEffect(() => setAiDraft(ai), [ai])

  return (
    <div className="vss-stack" data-testid="panel-settings">
      <Card title="Plan">
        {usage ? (
          <div className="vss-row">
            <Badge tone={usage.plan === "pro" ? "accent" : "neutral"}>{usage.plan === "pro" ? "Pro" : "Free"}</Badge>
            {usage.plan === "free" && (
              <span className="vss-muted">
                {usage.remaining ?? 0} of {usage.limit || FREE_LIMIT} free audits/generations left
              </span>
            )}
          </div>
        ) : (
          <span className="vss-muted">Unlimited (no license server configured).</span>
        )}
        <LicenseForm />
      </Card>

      <Card title="Site defaults">
        <Field label="Brand / site name">{(id) => <TextInput id={id} value={brand} onChange={(e) => setBrand(e.target.value)} />}</Field>
        <Field label="Target keywords" help="Comma separated. Used for meta descriptions and weak alt text only — never stuffed.">
          {(id, d) => <TextInput id={id} aria-describedby={d} value={keywords} onChange={(e) => setKeywords(e.target.value)} />}
        </Field>
        <Field label="Max alt text length">
          {(id) => (
            <TextInput id={id} type="number" min={40} max={250} value={settings.altMaxLength} onChange={(e) => void updateSettings({ altMaxLength: Number(e.target.value) || 125 })} />
          )}
        </Field>
        <Button
          onClick={async () => {
            await updateSettings({ brand: brand.trim(), keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) })
            setSaved("Site defaults saved.")
          }}
        >
          Save defaults
        </Button>
      </Card>

      <Card title="AI assist (optional, bring your own key)">
        <p className="vss-help" style={{ margin: 0 }}>
          The rule-based engine works without any key. Add your own key to describe images the filename parser can't. Keys are stored only on this device and sent directly to the provider.
        </p>
        <div className="vss-grid-2">
          <Field label="Provider">
            {(id) => (
              <Select
                id={id}
                value={aiDraft.provider}
                onChange={(e) => setAiDraft({ ...aiDraft, provider: e.target.value as AiSettings["provider"], model: "" })}
                options={[
                  { value: "none", label: "Off (rule-based only)" },
                  { value: "anthropic", label: "Anthropic Claude" },
                  { value: "openai", label: "OpenAI" },
                ]}
              />
            )}
          </Field>
          {aiDraft.provider !== "none" && (
            <Field label="Model">
              {(id) => (
                <Select
                  id={id}
                  value={aiDraft.model || DEFAULT_AI_MODELS[aiDraft.provider as "anthropic" | "openai"]}
                  onChange={(e) => setAiDraft({ ...aiDraft, model: e.target.value })}
                  options={AI_MODEL_CHOICES[aiDraft.provider as "anthropic" | "openai"].map((m) => ({ value: m, label: m }))}
                />
              )}
            </Field>
          )}
        </div>
        {aiDraft.provider !== "none" && (
          <>
            <Field label="API key">
              {(id) => <TextInput id={id} type="password" autoComplete="off" value={aiDraft.apiKey} onChange={(e) => setAiDraft({ ...aiDraft, apiKey: e.target.value })} />}
            </Field>
            <Field label="Use AI for">
              {(id) => (
                <Select
                  id={id}
                  value={aiDraft.scope}
                  onChange={(e) => setAiDraft({ ...aiDraft, scope: e.target.value as AiSettings["scope"] })}
                  options={[
                    { value: "low-confidence", label: "Only low-confidence images (cheapest)" },
                    { value: "all", label: "Every image" },
                  ]}
                />
              )}
            </Field>
          </>
        )}
        <Button
          onClick={async () => {
            await updateAi(aiDraft)
            setSaved("AI settings saved on this device.")
          }}
        >
          Save AI settings
        </Button>
      </Card>
      <Status>{saved}</Status>
    </div>
  )
}
