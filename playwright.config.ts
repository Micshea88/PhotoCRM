import { defineConfig, devices } from "@playwright/test"

const PORT = process.env.PORT ?? "3000"
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`

// Tests truncate this DB between specs and the webServer reads from it. They
// MUST agree, otherwise tests reset one DB while the app talks to another
// (the bug that left committed test artifacts in `test-results/` originally).
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pathway_test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Always 1 worker — tests share a single test database and rely on
  // between-test resets that can't run concurrently.
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
        // Always (re-)migrate the test DB before the app starts so a fresh
        // checkout's first `pnpm test:e2e` doesn't fail with "relation does
        // not exist".
        command: "pnpm db:migrate && pnpm build && pnpm start",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180 * 1000,
        env: {
          DATABASE_URL: TEST_DATABASE_URL,
          // Tells `src/lib/auth.ts` to skip email verification for the test
          // run (otherwise sign-up dead-ends without an email round-trip).
          // Vercel never sets this, so it can't be triggered in production.
          PLAYWRIGHT_E2E: "1",
        },
      },
})
