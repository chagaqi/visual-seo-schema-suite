import { mapWithConcurrency } from "../net/rateLimiter.ts"
import { describeImageWithAi, type AiConfig } from "./ai.ts"
import { generateAltText, type AltTextContext, type AltTextOptions, type AltTextResult } from "./generate.ts"

export interface BulkAltItem {
  id: string
  context: AltTextContext
}

export interface BulkAltResult extends AltTextResult {
  id: string
  /** Rule-based result kept for comparison when AI produced the final text. */
  ruleBased?: AltTextResult
  error?: string
}

export interface BulkAltOptions extends AltTextOptions {
  ai?: AiConfig | null
  /** "low-confidence" (default) only sends images flagged for review to the AI; "all" sends everything. */
  aiScope?: "low-confidence" | "all"
  concurrency?: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Generate alt text for many images. Rule-based first (instant, free), optional AI upgrade for
 * low-confidence items, identical image URLs computed once.
 */
export async function generateBulkAltText(items: BulkAltItem[], options: BulkAltOptions = {}): Promise<BulkAltResult[]> {
  const { ai, aiScope = "low-confidence", concurrency = 4, onProgress, signal, ...altOptions } = options
  const cache = new Map<string, Promise<AltTextResult & { ruleBased?: AltTextResult; error?: string }>>()
  let done = 0

  const compute = async (ctx: AltTextContext) => {
    const rule = generateAltText(ctx, altOptions)
    const wantsAi = ai && rule.source !== "existing" && (aiScope === "all" || rule.needsReview)
    if (!wantsAi) return rule
    try {
      const res = await describeImageWithAi(ctx, { ...ai, ...(signal ? { signal } : {}) }, altOptions.maxLength)
      return {
        ...rule,
        alt: res.alt,
        decorative: res.decorative,
        confidence: 0.9,
        source: "ai" as const,
        needsReview: false,
        reasons: [`Described by ${ai.provider}`, ...rule.reasons],
        ruleBased: rule,
      }
    } catch (error) {
      if (signal?.aborted) throw error
      return { ...rule, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return mapWithConcurrency(
    items,
    concurrency,
    async (item) => {
      // Same image + same caption/layer context → same answer; avoid paying twice.
      const key = JSON.stringify([item.context.src, item.context.filename, item.context.layerName, item.context.existingAlt])
      let pending = cache.get(key)
      if (!pending) {
        pending = compute(item.context)
        cache.set(key, pending)
      }
      const result = await pending
      done++
      onProgress?.(done, items.length)
      return { ...result, id: item.id }
    },
    signal,
  )
}
