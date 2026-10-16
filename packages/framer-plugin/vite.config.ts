import { fileURLToPath } from "node:url"
import { defineConfig, type PluginOption } from "vite"
import react from "@vitejs/plugin-react"
import framer from "vite-plugin-framer"
import mkcert from "vite-plugin-mkcert"

// `--mode e2e` swaps the real Framer SDK for an in-memory fake so the plugin can be driven by
// headless Chromium outside Framer (see src/testing/fakeFramer.ts and /e2e).
export default defineConfig(({ mode, command }) => {
  const e2e = mode === "e2e"
  const plugins: PluginOption[] = [react()]
  if (!e2e) plugins.push(framer())
  if (command === "serve" && !e2e) plugins.push(mkcert())
  return {
    plugins,
    resolve: e2e
      ? { alias: [{ find: /^@framer\/plugin$/, replacement: fileURLToPath(new URL("./src/testing/fakeFramer.ts", import.meta.url)) }] }
      : undefined,
    build: { outDir: e2e ? "dist-e2e" : "dist", target: "es2022" },
    preview: { port: 4301, strictPort: true },
  }
})
