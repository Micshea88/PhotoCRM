/**
 * Push 2c.2 — SelectionBanner component tests.
 *
 * The banner replaces the row-above-table "Actions" dropdown's
 * 1+-selected face. It appears only when selection is non-empty,
 * exposes the bulk actions inline (Delete / Change owner / Change
 * status / Add tag / Remove tag), and clears the selection on Esc
 * or "Clear" click.
 *
 * Server actions are mocked — these tests cover the banner's UI
 * contract, not the action layer (which has its own integration
 * tests in contacts.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SelectionBanner } from "@/modules/contacts/ui/selection-banner"

// next/navigation isn't available in jsdom; the banner imports
// useRouter for router.refresh(). Mock with a no-op router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
  }),
}))

// The server actions are also unavailable in jsdom (they're
// "use server" modules). Mock the module so the banner's import
// resolves; individual tests don't invoke the bulk buttons.
vi.mock("@/modules/contacts/actions", () => ({
  bulkAddTag: vi.fn(),
  bulkChangeContactType: vi.fn(),
  bulkChangeOwner: vi.fn(),
  bulkChangeStatus: vi.fn(),
  bulkDeleteContacts: vi.fn(),
  bulkRemoveTag: vi.fn(),
  bulkUpdateContactFields: vi.fn(),
}))

// P3 (C3) — SelectionBanner now imports BulkEditDrawer which imports
// CompanyPicker, transitively pulling in @/modules/companies/actions
// → @/lib/db. Stub the server-action surface so the import resolves.
vi.mock("@/modules/companies/actions", () => ({
  createCompany: () => Promise.resolve({ data: { id: "stub", name: "Stub" } }),
}))

// See contacts-actions-dropdown.test.tsx for why we shim these.
beforeEach(() => {
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  })
  Object.defineProperty(Element.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  })
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  })
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  })
})

const owners = [
  { id: "user-a", name: "Alice", email: "alice@example.com" },
  { id: "user-b", name: "Bob", email: "bob@example.com" },
]
const tags = ["vip", "hot-lead"]

describe("SelectionBanner", () => {
  it("renders nothing when no rows are selected", () => {
    const { container } = render(
      <SelectionBanner
        selectedIds={[]}
        ownerOptions={owners}
        tagOptions={tags}
        onClear={() => undefined}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders the count + Clear + all 5 bulk actions when 3 selected", () => {
    render(
      <SelectionBanner
        selectedIds={["c-1", "c-2", "c-3"]}
        ownerOptions={owners}
        tagOptions={tags}
        onClear={() => undefined}
      />,
    )
    // aria-live="polite" announces the count.
    const count = screen.getByText("3 selected")
    expect(count.getAttribute("aria-live")).toBe("polite")

    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Change owner" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Change status" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Change type" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add tag" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Remove tag" })).toBeInTheDocument()
  })

  it("Change type button opens a modal with contactType options", async () => {
    const user = userEvent.setup()
    render(
      <SelectionBanner
        selectedIds={["c-1"]}
        ownerOptions={owners}
        tagOptions={tags}
        onClear={() => undefined}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Change type" }))
    // The modal lists every contact type from CONTACT_TYPES.
    expect(screen.getByRole("option", { name: "Lead" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Active Client" })).toBeInTheDocument()
  })

  it("Clear button invokes onClear", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(
      <SelectionBanner
        selectedIds={["c-1"]}
        ownerOptions={owners}
        tagOptions={tags}
        onClear={onClear}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Clear" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("Esc key clears the selection when banner is active", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(
      <SelectionBanner
        selectedIds={["c-1", "c-2"]}
        ownerOptions={owners}
        tagOptions={tags}
        onClear={onClear}
      />,
    )
    await user.keyboard("{Escape}")
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("Esc key does NOT call onClear when banner is unmounted (no selection)", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    const { rerender } = render(
      <SelectionBanner
        selectedIds={["c-1"]}
        ownerOptions={owners}
        tagOptions={tags}
        onClear={onClear}
      />,
    )
    // Re-render with empty selection — banner returns null + the Esc
    // handler is unmounted with the useEffect cleanup.
    rerender(
      <SelectionBanner
        selectedIds={[]}
        ownerOptions={owners}
        tagOptions={tags}
        onClear={onClear}
      />,
    )
    await user.keyboard("{Escape}")
    expect(onClear).not.toHaveBeenCalled()
  })

  it("Delete button opens the delete confirmation modal with a count-aware body", async () => {
    const user = userEvent.setup()
    render(
      <SelectionBanner
        selectedIds={["c-1", "c-2", "c-3"]}
        ownerOptions={owners}
        tagOptions={tags}
        onClear={() => undefined}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Delete" }))
    // DeleteConfirmModal body mentions "3 contacts" when count > 1.
    expect(screen.getByText(/3 contacts will be moved to Deleted/)).toBeInTheDocument()
  })

  it("Change owner button opens a modal that lists org members", async () => {
    const user = userEvent.setup()
    render(
      <SelectionBanner
        selectedIds={["c-1"]}
        ownerOptions={owners}
        tagOptions={tags}
        onClear={() => undefined}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Change owner" }))
    // Both owners + Unassigned + the placeholder render.
    expect(screen.getByRole("option", { name: "Alice" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Bob" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Unassigned" })).toBeInTheDocument()
  })
})
