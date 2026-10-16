import type Anthropic from "@anthropic-ai/sdk"
import { squish, truncateAtWord } from "../text/util.ts"
import type { AltTextContext } from "./generate.ts"

/**
 * Optional "bring your own key" vision describers. The suite works fully offline without them; when
 * configured they only upgrade low-confidence rule-based results. Keys stay in the user's browser
 * (localStorage on their machine) and are sent directly to the provider — never to our worker.
 */

export type AiProvider = "anthropic" | "openai"

export interface AiConfig {
  provider: AiProvider
  apiKey: string
  /** Defaults: anthropic → claude-opus-5-5, openai → gpt-4o-mini. */
  model?: string
  /** Inject for tests / proxies. */
  fetch?: typeof fetch
  signal?: AbortSignal
}

export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-4o-mini",
}

export const AI_MODEL_CHOICES: Record<AiProvider, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  openai: ["gpt-4o-mini", "gpt-4o"],
}

export class AiRefusalError extends Error {
  constructor(message = "The model declined to describe this image") {
    super(message)
    this.name = "AiRefusalError"
  }
}

/** Sentinel the model returns for purely decorative images. */
export const DECORATIVE_SENTINEL = "DECORATIVE"

export function buildAltPrompt(ctx: AltTextContext, maxLength = 125): string {
  const lines = [
    `Write alt text for this image as it appears on a web page. Requirements:`,
    `- At most ${maxLength} characters, one sentence fragment, no trailing period.`,
    `- Describe what matters for someone who cannot see it; do not start with "Image of" or "Picture of".`,
    `- If text is visible in the image and important, include it.`,
    `- If the image is purely decorative (pattern, texture, divider), reply exactly ${DECORATIVE_SENTINEL}.`,
    `- Reply with the alt text only, no quotes or commentary.`,
  ]
  const context: string[] = []
  if (ctx.pageTitle) context.push(`Page title: ${ctx.pageTitle}`)
  if (ctx.collectionItemTitle) context.push(`CMS item: ${ctx.collectionItemTitle}`)
  if (ctx.nearbyText) context.push(`Nearby text: ${truncateAtWord(ctx.nearbyText, 300)}`)
  if (ctx.layerName) context.push(`Layer name: ${ctx.layerName}`)
  if (ctx.filename) context.push(`Filename: ${ctx.filename}`)
  if (ctx.brand) context.push(`Brand: ${ctx.brand}`)
  if (ctx.linkHref) context.push(`The image links to: ${ctx.linkHref} (describe its function)`)
  if (ctx.keywords?.length) context.push(`Topic keywords (use only if accurate): ${ctx.keywords.join(", ")}`)
  if (context.length) lines.push("", "Context:", ...context)
  return lines.join("\n")
}

/** Normalise model output into alt text (strip quotes, prefixes, trailing period). */
export function cleanAiAlt(raw: string, maxLength = 125): string {
  let text = squish(raw)
    .replace(/^alt(\s*text)?\s*[:=-]\s*/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^(an?\s+)?(image|picture|photo)\s+of\s+/i, "")
    .replace(/\.+$/, "")
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1)
  return truncateAtWord(text, maxLength)
}

export interface AnthropicClientLike {
  beta: { messages: { create: Anthropic["beta"]["messages"]["create"] } }
}

let anthropicFactory: ((apiKey: string, fetchImpl?: typeof fetch) => Promise<AnthropicClientLike>) | null = null

/** Test hook: replace how the Anthropic client is constructed. */
export function setAnthropicClientFactory(
  factory: ((apiKey: string, fetchImpl?: typeof fetch) => Promise<AnthropicClientLike>) | null,
): void {
  anthropicFactory = factory
}

async function createAnthropicClient(apiKey: string, fetchImpl?: typeof fetch): Promise<AnthropicClientLike> {
  if (anthropicFactory) return anthropicFactory(apiKey, fetchImpl)
  // Lazy-loaded so the SDK never weighs down the default, zero-API bundle.
  const { default: AnthropicSDK } = await import("@anthropic-ai/sdk")
  return new AnthropicSDK({
    apiKey,
    // The user's own key, used from their own browser session inside the plugin iframe.
    dangerouslyAllowBrowser: true,
    maxRetries: 3,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
}

async function describeWithAnthropic(imageUrl: string, prompt: string, config: AiConfig): Promise<string> {
  const client = await createAnthropicClient(config.apiKey, config.fetch)
  const model = config.model || DEFAULT_AI_MODELS.anthropic
  const usesServerFallback = /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model)
  const response = await client.beta.messages.create(
    {
      model,
      max_tokens: 2048,
      output_config: { effort: "low" },
      ...(usesServerFallback
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: imageUrl } },
            { type: "text", text: prompt },
          ],
        },
      ],
    },
    config.signal ? { signal: config.signal } : undefined,
  )
  if (response.stop_reason === "refusal") throw new AiRefusalError()
  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join(" ")
    .trim()
  if (!text) throw new Error("Empty response from Anthropic")
  return text
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>
  error?: { message?: string }
}

async function describeWithOpenAi(imageUrl: string, prompt: string, config: AiConfig): Promise<string> {
  const fetchImpl = config.fetch ?? fetch
  const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model || DEFAULT_AI_MODELS.openai,
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
          ],
        },
      ],
    }),
    ...(config.signal ? { signal: config.signal } : {}),
  })
  const json = (await res.json().catch(() => ({}))) as OpenAiChatResponse
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${json.error?.message ?? res.statusText}`)
  const message = json.choices?.[0]?.message
  if (message?.refusal) throw new AiRefusalError(message.refusal)
  const text = message?.content?.trim()
  if (!text) throw new Error("Empty response from OpenAI")
  return text
}

export interface AiAltResult {
  alt: string
  decorative: boolean
}

/** Describe an image with the configured provider. Throws on failure — callers fall back to rules. */
export async function describeImageWithAi(ctx: AltTextContext, config: AiConfig, maxLength = 125): Promise<AiAltResult> {
  const imageUrl = ctx.src
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) throw new Error("AI description needs a public image URL")
  if (!config.apiKey) throw new Error("Missing API key")
  const prompt = buildAltPrompt(ctx, maxLength)
  const raw =
    config.provider === "anthropic"
      ? await describeWithAnthropic(imageUrl, prompt, config)
      : await describeWithOpenAi(imageUrl, prompt, config)
  if (raw.trim().toUpperCase().startsWith(DECORATIVE_SENTINEL)) return { alt: "", decorative: true }
  return { alt: cleanAiAlt(raw, maxLength), decorative: false }
}
