/**
 * Design tokens. The Framer theme reads Framer's live `--framer-color-*` variables (so the plugin follows
 * the editor's light/dark mode automatically) and falls back to Framer's dark palette (#111111).
 * The Webflow theme mirrors the Designer's compact dark panels.
 */

export type ThemeName = "framer" | "webflow" | "light"

export interface ThemeTokens {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  textSecondary: string
  textTertiary: string
  accent: string
  accentHover: string
  accentText: string
  danger: string
  warning: string
  success: string
  focus: string
  radius: string
  radiusSmall: string
  controlHeight: string
  fontFamily: string
  fontSize: string
  fontSizeSmall: string
  gap: string
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  framer: {
    bg: "var(--framer-color-bg, #111111)",
    surface: "var(--framer-color-bg-secondary, #1b1b1b)",
    surface2: "var(--framer-color-bg-tertiary, #2b2b2b)",
    border: "var(--framer-color-divider, rgba(255, 255, 255, 0.08))",
    text: "var(--framer-color-text, #ffffff)",
    textSecondary: "var(--framer-color-text-secondary, #999999)",
    textTertiary: "var(--framer-color-text-tertiary, #8a8a8a)",
    accent: "var(--framer-color-tint, #0099ff)",
    accentHover: "var(--framer-color-tint-dark, #0088e6)",
    accentText: "var(--framer-color-text-reversed, #ffffff)",
    danger: "#ff4d6d",
    warning: "#ffb020",
    success: "#22cc88",
    focus: "var(--framer-color-tint, #0099ff)",
    radius: "8px",
    radiusSmall: "6px",
    controlHeight: "30px",
    fontFamily: 'var(--framer-font-family, "Inter", system-ui, -apple-system, sans-serif)',
    fontSize: "12px",
    fontSizeSmall: "11px",
    gap: "10px",
  },
  webflow: {
    bg: "#1e1e1e",
    surface: "#2b2b2b",
    surface2: "#383838",
    border: "#363636",
    text: "#f5f5f5",
    textSecondary: "#bdbdbd",
    textTertiary: "#a3a3a3",
    accent: "#006acc",
    accentHover: "#0073e6",
    accentText: "#ffffff",
    danger: "#ff6b6b",
    warning: "#f5a623",
    success: "#2fbf71",
    focus: "#3d8bfd",
    radius: "4px",
    radiusSmall: "3px",
    controlHeight: "26px",
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: "11.5px",
    fontSizeSmall: "10.5px",
    gap: "8px",
  },
  light: {
    bg: "#ffffff",
    surface: "#f5f5f5",
    surface2: "#ebebeb",
    border: "rgba(0, 0, 0, 0.1)",
    text: "#111111",
    textSecondary: "#5c5c5c",
    textTertiary: "#6e6e6e",
    accent: "#0070d6",
    accentHover: "#005fb8",
    accentText: "#ffffff",
    danger: "#c8102e",
    warning: "#8a5a00",
    success: "#0b7a4b",
    focus: "#0070d6",
    radius: "8px",
    radiusSmall: "6px",
    controlHeight: "30px",
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    fontSize: "12px",
    fontSizeSmall: "11px",
    gap: "10px",
  },
}

const KEY_TO_VAR: Record<keyof ThemeTokens, string> = {
  bg: "--vss-bg",
  surface: "--vss-surface",
  surface2: "--vss-surface-2",
  border: "--vss-border",
  text: "--vss-text",
  textSecondary: "--vss-text-secondary",
  textTertiary: "--vss-text-tertiary",
  accent: "--vss-accent",
  accentHover: "--vss-accent-hover",
  accentText: "--vss-accent-text",
  danger: "--vss-danger",
  warning: "--vss-warning",
  success: "--vss-success",
  focus: "--vss-focus",
  radius: "--vss-radius",
  radiusSmall: "--vss-radius-sm",
  controlHeight: "--vss-control-h",
  fontFamily: "--vss-font",
  fontSize: "--vss-font-size",
  fontSizeSmall: "--vss-font-size-sm",
  gap: "--vss-gap",
}

export function themeToCssVars(tokens: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(tokens) as Array<keyof ThemeTokens>) out[KEY_TO_VAR[key]] = tokens[key]
  return out
}
