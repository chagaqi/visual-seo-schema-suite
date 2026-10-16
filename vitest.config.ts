import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      "packages/core-engine",
      "packages/ui-kit",
      "packages/framer-plugin",
      "packages/webflow-extension",
      "packages/license-worker",
    ],
  },
})
