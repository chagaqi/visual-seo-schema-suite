import { defineProject } from "vitest/config"

export default defineProject({
  test: {
    name: "framer-plugin",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
})
