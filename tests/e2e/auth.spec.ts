import { test, expect } from "@playwright/test"
import { resetDatabase } from "./helpers/reset-db"

const DB_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pathway_test"

test.beforeEach(async () => {
  await resetDatabase(DB_URL)
})

test("sign-up → onboarding → dashboard golden path", async ({ page }) => {
  const email = `user-${String(Date.now())}@example.com`
  const password = "supersecure-test-password-1234"

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("Test User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()

  // In dev/test, requireEmailVerification is false, so the user is signed in
  // and routed to the org-create onboarding.
  await expect(page).toHaveURL(/\/onboarding\/create-organization/, { timeout: 10000 })

  await page.getByLabel("Studio name").fill("Acme Test Co")
  // Slug auto-fills.
  await page.getByRole("button", { name: "Create organization" }).click()

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 })
  // The dashboard's welcome heading includes the studio name (P4.1).
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome, Test")
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Acme Test Co")
})

test("sign-out then sign-in", async ({ page }) => {
  const email = `user-${String(Date.now())}@example.com`
  const password = "supersecure-test-password-1234"

  // Sign up + create org first
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("Test User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/onboarding\/create-organization/, { timeout: 10000 })
  await page.getByLabel("Studio name").fill("Acme Test Co")
  await page.getByRole("button", { name: "Create organization" }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 })

  // Sign out via the user menu
  await page.getByRole("button", { name: "User menu" }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 10000 })

  // Sign in again
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 })
})
