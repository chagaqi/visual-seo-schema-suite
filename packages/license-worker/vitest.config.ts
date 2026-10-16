import { defineProject } from "vitest/config"

export default defineProject({
  test: {
    name: "license-worker",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
})
