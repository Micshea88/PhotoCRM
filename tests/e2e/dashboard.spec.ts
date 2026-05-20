/**
 * P4.1 dashboard e2e — fresh signup → onboarding → dashboard renders
 * all 5 widget headings without error states.
 *
 * Mirrors the sign-up shape from auth.spec.ts; this suite focuses on
 * what's actually on the dashboard page.
 */
import { test, expect } from "@playwright/test"
import { resetDatabase } from "./helpers/reset-db"

const DB_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pathway_test"

test.beforeEach(async () => {
  await resetDatabase(DB_URL)
})

test("dashboard renders all five widgets for a fresh studio", async ({ page }) => {
  const email = `user-${String(Date.now())}@example.com`
  const password = "supersecure-test-password-1234"
  const studioName = "Acme Studio"

  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("Mike Test")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page).toHaveURL(/\/onboarding\/create-organization/, { timeout: 10000 })
  await page.getByLabel("Studio name").fill(studioName)
  await page.getByRole("button", { name: "Create organization" }).click()

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 })

  // Welcome header includes first name + studio name (LOC1 prose check).
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome, Mike")
  await expect(page.getByRole("heading", { level: 1 })).toContainText(studioName)

  // Three count cards.
  await expect(page.getByText("Open opportunities")).toBeVisible()
  await expect(page.getByText("Projects this month")).toBeVisible()
  await expect(page.getByText("Tasks due this week", { exact: true })).toBeVisible()

  // Team This Week card (fresh studio has the seeded view but no tasks).
  await expect(page.getByRole("heading", { name: "Team This Week" })).toBeVisible()

  // Topbar shows the studio name, not "Pathway."
  await expect(page.locator("header").first()).toContainText(studioName)

  // AI-assistant placeholder slot is present but disabled.
  const aiButton = page.getByRole("button", { name: "AI assistant (coming soon)" })
  await expect(aiButton).toBeVisible()
  await expect(aiButton).toBeDisabled()
})
