/**
 * PHASE 0 reskin guardrail (LAW 7 — assert the observable result).
 *
 * Locks the bell-dropdown GEOMETRY that the reskin must never disturb:
 *   - dropdown computed width === 448px
 *   - every row computed min-height >= 88px
 *   - on hover, the persistent unread dot AND the bottom-right action zone are
 *     visible SIMULTANEOUSLY (the ~8px clearance survives; the dot does not hide)
 *   - an action-icon tooltip renders in a PORTAL outside the dropdown (un-clipped)
 *
 * Must stay green through every reskin phase.
 */
import { test, expect, type Page } from "@playwright/test"
import { resetDatabase } from "./helpers/reset-db"
import { seedUnreadNotification } from "./helpers/seed-e2e"

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

test("bell dropdown geometry is locked: 448px wide, rows >= 88px, dot+actions coexist on hover, tooltip un-clipped", async ({
  page,
}) => {
  const email = await signUpAndCreateOrg(page)
  // A normal row + a SHORT no-body row — the short row is the collision-prone case.
  await seedUnreadNotification(DB_URL, email, {
    title: "Payment received",
    body: "A deposit landed for an upcoming session.",
  })
  await seedUnreadNotification(DB_URL, email, {
    type: "lead.new_inquiry",
    category: "leads",
    title: "New inquiry from a couple",
    body: null,
  })
  await page.reload()

  // Open the bell dropdown.
  await page.getByTestId("notification-bell").click()
  const dropdown = page.getByTestId("notification-dropdown")
  await expect(dropdown).toBeVisible()

  // 1) Dropdown width is exactly 448px.
  const width = await dropdown.evaluate((el) => getComputedStyle(el).width)
  expect(width).toBe("448px")

  // 2) Every row's computed min-height is >= 88px. Wait for the async fetch to
  //    render rows before counting (the dropdown shows a skeleton first).
  const rows = page.getByTestId("notification-row")
  await expect(rows.first()).toBeVisible({ timeout: 15000 })
  const count = await rows.count()
  expect(count).toBeGreaterThanOrEqual(2)
  for (let i = 0; i < count; i++) {
    const minH = await rows.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).minHeight))
    expect(minH).toBeGreaterThanOrEqual(88)
  }

  // 3) Hover the SHORT row: the persistent unread dot AND the hover action zone
  //    are BOTH visible at once — the dot does not hide on hover, and the zone
  //    lives in its own band below it.
  const shortRow = rows.filter({ hasText: "New inquiry from a couple" })
  await shortRow.hover()
  await expect(shortRow.getByTestId("notification-read-dot")).toBeVisible()
  await expect(shortRow.getByTestId("notification-action-zone")).toBeVisible()

  // 4) Hover an action icon: its tooltip renders in a PORTAL outside the
  //    dropdown's scroll container (Radix portals to document.body → un-clipped).
  await shortRow.getByTestId("action-archive").hover()
  const tooltip = page.getByRole("tooltip", { name: "Archive" })
  await expect(tooltip).toBeVisible()
  const dropdownHandle = await dropdown.elementHandle()
  const insideDropdown = await tooltip.evaluate(
    (el, dd) => (dd instanceof Node ? dd.contains(el) : false),
    dropdownHandle,
  )
  expect(insideDropdown).toBe(false)
})
