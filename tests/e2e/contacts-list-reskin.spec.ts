/**
 * Phase 4d smoke — the contacts-list restructure renders and works end-to-end:
 * the Saved Views LEFT panel, the category-colored row avatar, the dropped
 * description line, and the collapsible panel. Not a locked gate; a guard that
 * the protected-page restructure didn't break the list at runtime.
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

test("contacts list: saved-views left panel, row avatar, dropped description, collapsible panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const email = await signUpAndCreateOrg(page)
  await seedContact(DB_URL, email, { firstName: "Jane", lastName: "Smith" })
  await page.goto("/contacts")

  // Saved Views LEFT panel present (its own card with the "Saved views" label).
  await expect(page.getByText("Saved views")).toBeVisible()

  // The contact renders in the table, with its 26px category avatar initials.
  await expect(page.getByText("Jane Smith")).toBeVisible()
  await expect(page.getByText("JS", { exact: true })).toBeVisible()

  // The old description line is gone.
  await expect(page.getByText(/People — the permanent record/)).toHaveCount(0)

  // The panel collapses (and the toggle flips), independent of the nav.
  await page.getByRole("button", { name: "Collapse saved views" }).click()
  await expect(page.getByRole("button", { name: "Expand saved views" })).toBeVisible()
})
