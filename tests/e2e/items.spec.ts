import { test, expect, type Page } from "@playwright/test"
import { resetDatabase } from "./helpers/reset-db"

const DB_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pathway_test"

async function signUpAndCreateOrg(page: Page) {
  const email = `user-${String(Date.now())}-${Math.random().toString(36).slice(2, 6)}@example.com`
  const password = "supersecure-test-password-1234"
  await page.goto("/sign-up")
  await page.getByLabel("Name").fill("Test User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/onboarding\/create-organization/, { timeout: 10000 })
  await page.getByLabel("Organization name").fill("Acme Test Co")
  await page.getByRole("button", { name: "Create organization" }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 })
}

test.beforeEach(async () => {
  await resetDatabase(DB_URL)
})

test("items CRUD golden path", async ({ page }) => {
  await signUpAndCreateOrg(page)

  // Create
  await page.goto("/items")
  await page.getByRole("link", { name: "New item" }).click()
  await expect(page).toHaveURL(/\/items\/new/, { timeout: 10000 })
  await page.getByLabel("Name").fill("My first item")
  await page.getByLabel("Description").fill("This is a description")
  await page.getByLabel("Status").selectOption("active")
  await page.getByRole("button", { name: "Create item" }).click()
  await expect(page).toHaveURL(/\/items$/, { timeout: 10000 })

  // List shows it
  await expect(page.getByText("My first item")).toBeVisible()

  // Detail
  await page.getByRole("link", { name: /My first item/ }).click()
  await expect(page.getByRole("heading", { name: "My first item" })).toBeVisible()

  // Edit
  await page.getByRole("link", { name: "Edit" }).click()
  await page.getByLabel("Name").fill("My renamed item")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page).toHaveURL(/\/items$/, { timeout: 10000 })
  await expect(page.getByText("My renamed item")).toBeVisible()

  // Delete (soft)
  await page.getByRole("link", { name: /My renamed item/ }).click()
  await page.getByRole("button", { name: "Delete" }).click()
  await expect(page).toHaveURL(/\/items$/, { timeout: 10000 })
  await expect(page.getByText("No items yet")).toBeVisible()
})
