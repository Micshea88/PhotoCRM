import { defineConfig, devices } from "@playwright/test"

const PORT = process.env.PORT ?? "3000"
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Always 1 worker — tests share a single test database and rely on between-test
  // resets that can't run concurrently.
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: "pnpm build && pnpm start",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
})
