import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Webflow bundles the contents of `publicDir` (dist) into a zip; everything must be static and
// relative. `--mode e2e` builds into dist-e2e with a fake Designer API installed (see /e2e).
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react()],
  build: { outDir: mode === "e2e" ? "dist-e2e" : "dist", target: "es2022", assetsInlineLimit: 0 },
  preview: { port: 4302, strictPort: true },
}))
