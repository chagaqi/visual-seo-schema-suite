import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { AiConfig, HostAdapter, LicenseClient, MeteredFeature, UsageStatus, WcagLevel } from "@vss/core-engine"

export interface SiteSettings {
  brand: string
  keywords: string[]
  level: WcagLevel
  altMaxLength: number
}

export interface AiSettings {
  provider: "none" | AiConfig["provider"]
  apiKey: string
  model: string
  scope: "low-confidence" | "all"
}

const DEFAULT_SETTINGS: SiteSettings = { brand: "", keywords: [], level: "AA", altMaxLength: 125 }
const DEFAULT_AI: AiSettings = { provider: "none", apiKey: "", model: "", scope: "low-confidence" }

const KEY_SETTINGS = "vss:settings"
const KEY_AI = "vss:ai"

interface SuiteContextValue {
  adapter: HostAdapter
  license: LicenseClient | null
  checkoutUrl: string
  settings: SiteSettings
  updateSettings: (patch: Partial<SiteSettings>) => Promise<void>
  ai: AiSettings
  updateAi: (patch: Partial<AiSettings>) => Promise<void>
  aiConfig: AiConfig | null
  usage: UsageStatus | null
  refreshUsage: () => Promise<void>
  /** Spend a credit, then run `task`. Opens the upgrade dialog (and skips the task) when exhausted. */
  metered: <T>(feature: MeteredFeature, task: () => Promise<T>) => Promise<T | undefined>
  upgradeOpen: boolean
  setUpgradeOpen: (open: boolean) => void
}

const SuiteContext = createContext<SuiteContextValue | null>(null)

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    return fallback
  }
}

export function SuiteProvider({
  adapter,
  license,
  checkoutUrl,
  children,
}: {
  adapter: HostAdapter
  license: LicenseClient | null
  checkoutUrl: string
  children: ReactNode
}) {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS)
  const [ai, setAi] = useState<AiSettings>(DEFAULT_AI)
  const [usage, setUsage] = useState<UsageStatus | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const aiRef = useRef(ai)
  aiRef.current = ai

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [s, a] = await Promise.all([adapter.projectStorage.get(KEY_SETTINGS), adapter.deviceStorage.get(KEY_AI)])
      if (cancelled) return
      setSettings(safeParse(s, DEFAULT_SETTINGS))
      setAi(safeParse(a, DEFAULT_AI))
    })()
    return () => {
      cancelled = true
    }
  }, [adapter])

  const refreshUsage = useCallback(async () => {
    if (!license) return
    setUsage(await license.status())
  }, [license])

  useEffect(() => {
    void refreshUsage()
  }, [refreshUsage])

  const updateSettings = useCallback(
    async (patch: Partial<SiteSettings>) => {
      const next = { ...settingsRef.current, ...patch }
      setSettings(next)
      await adapter.projectStorage.set(KEY_SETTINGS, JSON.stringify(next))
    },
    [adapter],
  )

  const updateAi = useCallback(
    async (patch: Partial<AiSettings>) => {
      const next = { ...aiRef.current, ...patch }
      setAi(next)
      await adapter.deviceStorage.set(KEY_AI, JSON.stringify(next))
    },
    [adapter],
  )

  const aiConfig = useMemo<AiConfig | null>(
    () => (ai.provider !== "none" && ai.apiKey ? { provider: ai.provider, apiKey: ai.apiKey, ...(ai.model ? { model: ai.model } : {}) } : null),
    [ai],
  )

  const metered = useCallback(
    async <T,>(feature: MeteredFeature, task: () => Promise<T>): Promise<T | undefined> => {
      if (license) {
        const status = await license.consume(feature)
        setUsage(status)
        if (!status.allowed) {
          setUpgradeOpen(true)
          return undefined
        }
      }
      return task()
    },
    [license],
  )

  const value: SuiteContextValue = {
    adapter,
    license,
    checkoutUrl,
    settings,
    updateSettings,
    ai,
    updateAi,
    aiConfig,
    usage,
    refreshUsage,
    metered,
    upgradeOpen,
    setUpgradeOpen,
  }
  return <SuiteContext.Provider value={value}>{children}</SuiteContext.Provider>
}

export function useSuite(): SuiteContextValue {
  const ctx = useContext(SuiteContext)
  if (!ctx) throw new Error("useSuite must be used inside <SuiteProvider>")
  return ctx
}

/** Track an async action's pending state and surface errors as notifications. */
export function useAction() {
  const { adapter } = useSuite()
  const [pending, setPending] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setPending(name)
      try {
        return await fn()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        adapter.notify(message, "error")
        return undefined
      } finally {
        setPending(null)
      }
    },
    [adapter],
  )
  return { pending, run }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for sandboxed iframes without clipboard permission.
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
