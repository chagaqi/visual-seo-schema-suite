import { defineProject } from "vitest/config"

export default defineProject({
  test: {
    name: "webflow-extension",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
})
