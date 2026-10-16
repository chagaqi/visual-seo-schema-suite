import { defineConfig, devices } from "@playwright/test"

/**
 * Headless Chromium UI tests. Each plugin is built in `e2e` mode (real UI + real adapter, fake host
 * SDK) and served with `vite preview`. Run `npm run test:e2e` (builds first).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  use: {
    headless: true,
    viewport: { width: 400, height: 760 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 400, height: 760 } } }],
  webServer: [
    { command: "npm run preview:e2e -w @vss/framer-plugin", url: "http://localhost:4301", reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: "npm run preview:e2e -w @vss/webflow-extension", url: "http://localhost:4302", reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: "npm run preview -w @vss/playground", url: "http://localhost:4303", reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
})
