/**
 * PHASE 0 reskin guardrail (LAW 7 — assert the observable result).
 *
 * Contact detail ships FULL-WIDTH (no centered island). At 1440px the detail
 * content must span effectively the whole main region — not sit capped in a
 * narrow centered column. Guards against a width cap being reintroduced during
 * the reskin (LAW 6). Must stay green through every phase.
 */
import { test, expect, type Page } from "@playwright/test"
import { resetDatabase } from "./helpers/reset-db"
import { seedContact } from "./helpers/seed-e2e"

const DB_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pathway_test"

async function signUpAndCreateOrg(page: Page): Promise<string> {
  const email = `user-${String(Date.now())}-${Math.random().toString(36).slice(2, 6)}@example.com`
  const password = "supersecure-test-password-1234"
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("Test User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByLabel("Confirm password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/onboarding\/create-organization/, { timeout: 15000 })
  await page.getByLabel("Studio name").fill("Acme Test Co")
  await page.getByRole("button", { name: "Create organization" }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 })
  return email
}

test.beforeEach(async () => {
  await resetDatabase(DB_URL)
})

test("contact detail spans full width at 1440px (no centered island)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const email = await signUpAndCreateOrg(page)
  const contactId = await seedContact(DB_URL, email, { firstName: "Jane", lastName: "Smith" })

  await page.goto(`/contacts/${contactId}`)
  await expect(page.getByRole("heading", { name: /Jane Smith/ })).toBeVisible()

  // Measure the main region and the detail's content header (a full-width block
  // at the top of the page body). If the detail were a centered island, the
  // header would be much narrower than main and inset by a large left margin.
  const main = page.locator("main")
  const header = main.locator("header").first()
  const mainBox = await main.boundingBox()
  const headerBox = await header.boundingBox()
  expect(mainBox).not.toBeNull()
  expect(headerBox).not.toBeNull()

  // No centered island: the content spans the main region minus only gutter
  // padding, and its left inset is a gutter, not a centering margin. Tolerances
  // are loose enough to pass BOTH the current doubled gutter (main p-6 + page
  // px-6 ≈ 96px total, 48px left — the LAW-6 doubling Phase 3 removes) AND the
  // post-reskin single gutter (~48px total, 24px left), while still catching a
  // real width cap: e.g. max-w-4xl (896px) centered in a ~1184px main would
  // leave a ~288px width deficit and a ~144px left margin — both far over.
  expect(mainBox!.width - headerBox!.width).toBeLessThanOrEqual(120)
  expect(headerBox!.x - mainBox!.x).toBeLessThanOrEqual(80)
})
