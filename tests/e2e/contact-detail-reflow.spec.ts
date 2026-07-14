/**
 * PHASE 0 spec #3 (authored WITH Phase 4b — red→green gate). LAW 7.
 *
 * The contact-detail desktop grid must reflow by the space ACTUALLY AVAILABLE
 * (container queries), not the viewport — so nav-expanded vs collapsed changes
 * the layout at the SAME viewport:
 *   - the middle column never renders below its 420px floor (no sub-floor crush),
 *   - in the medium band the right sidebar wraps to a full-width row UNDER
 *     left+center (col-span-2), not a 3rd crushed track,
 *   - no column overlaps another (right never covers the middle's header).
 *
 * RED on the old viewport-based `lg:grid-cols-[…minmax(0,1fr)…]` grid (which is
 * always 3-col regardless of nav, and crushes the middle); GREEN after 4b.
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

async function cols(page: Page) {
  const box = async (tid: string) => {
    const b = await page.getByTestId(tid).boundingBox()
    if (!b) throw new Error(`no bounding box for ${tid}`)
    return b
  }
  return {
    left: await box("detail-col-left"),
    center: await box("detail-col-center"),
    right: await box("detail-col-right"),
  }
}

test("contact detail grid reflows by available width (nav-expanded 2-col right-wraps; collapsed 3-col), middle never crushes, no overlap", async ({
  page,
}) => {
  // 1400px viewport: nav EXPANDED → container ~1112px (2-col); nav COLLAPSED →
  // container ~1296px (3-col). Same viewport, different nav — proves container
  // queries, not viewport breakpoints.
  await page.setViewportSize({ width: 1400, height: 1000 })
  const email = await signUpAndCreateOrg(page)
  const id = await seedContact(DB_URL, email, { firstName: "Jane", lastName: "Smith" })
  await page.goto(`/contacts/${id}`)
  await expect(page.getByTestId("contact-detail-grid")).toBeVisible()

  // Ensure nav is EXPANDED (the toggle reads "Collapse navigation" when expanded).
  const collapseBtn = page.getByRole("button", { name: "Collapse navigation" })
  const expandBtn = page.getByRole("button", { name: "Expand navigation" })
  if (await expandBtn.isVisible().catch(() => false)) {
    await expandBtn.click()
  }
  await expect(collapseBtn).toBeVisible()

  // ── Nav EXPANDED → 2 COLUMNS, right wraps to a full-width row below ──
  {
    const { left, center, right } = await cols(page)
    expect(center.width).toBeGreaterThanOrEqual(420) // middle never crushed
    // left + center side-by-side on row 1 (no overlap)
    expect(center.x).toBeGreaterThanOrEqual(left.x + left.width - 4)
    // right wrapped BELOW the top row and spans wider than the center (col-span-2)
    expect(right.y).toBeGreaterThan(center.y + 40)
    expect(right.width).toBeGreaterThan(center.width)
    // no overlap: right starts at/under the bottom of the top row
    expect(right.y + 4).toBeGreaterThanOrEqual(
      Math.min(left.y + left.height, center.y + center.height) - 8,
    )
  }

  // ── Collapse nav → 3 COLUMNS, right beside center on the same row ──
  await collapseBtn.click()
  await expect(expandBtn).toBeVisible()
  await page.waitForTimeout(300) // let the container-query reflow settle
  {
    const { left, center, right } = await cols(page)
    expect(center.width).toBeGreaterThanOrEqual(420) // still never crushed
    // three columns on one row, left < center < right by x, no overlap
    expect(center.x).toBeGreaterThanOrEqual(left.x + left.width - 4)
    expect(right.x).toBeGreaterThanOrEqual(center.x + center.width - 4)
    expect(Math.abs(right.y - center.y)).toBeLessThan(40) // same row
    // right is now a narrow sidebar, not the full-width wrap
    expect(right.width).toBeLessThan(center.width)
  }
})
