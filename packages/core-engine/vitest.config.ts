import { defineProject } from "vitest/config"

export default defineProject({
  test: {
    name: "core-engine",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
})
