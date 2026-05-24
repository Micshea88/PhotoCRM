/**
 * Push 2c.4 part 2 — BulkEditDrawer tests.
 *
 * Asserts the drawer's UI contract:
 *   - Header shows the selected count.
 *   - Search bar filters the field list (matches field label OR
 *     group name).
 *   - All four groups render their expected items.
 *   - "Replace all tags" requires the destructive confirm check
 *     before Apply enables.
 *   - Apply button stays disabled until a field + value are picked;
 *     calls bulkUpdateContactFields with the discriminated update
 *     payload on click.
 *   - Drawer remounts fresh per open (no leftover state).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BulkEditDrawer } from "@/modules/contacts/ui/bulk-edit-drawer"

const bulkUpdateMock = vi.fn((_input: unknown) => Promise.resolve({ data: { updatedIds: [] } }))
const refreshMock = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {
      refreshMock()
    },
    push: () => undefined,
    replace: () => undefined,
  }),
}))

vi.mock("@/modules/contacts/actions", () => ({
  bulkUpdateContactFields: (input: unknown) => bulkUpdateMock(input),
}))

beforeEach(() => {
  bulkUpdateMock.mockClear()
  refreshMock.mockClear()
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  })
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  })
})

const baseProps = {
  selectedIds: ["c-1", "c-2", "c-3"],
  companyOptions: [{ id: "co-1", name: "Acme" }],
  ownerOptions: [{ id: "user-1", name: "Mike", email: "mike@example.com" }],
  leadSourceOptions: ["Referral"],
  tagOptions: ["vip"],
}

describe("BulkEditDrawer", () => {
  it("renders header with selected count", () => {
    render(
      <BulkEditDrawer
        open={true}
        onClose={() => undefined}
        onAfterApply={() => undefined}
        {...baseProps}
      />,
    )
    expect(
      screen.getByRole("heading", { name: /Bulk edit — 3 contacts selected/i }),
    ).toBeInTheDocument()
  })

  it("returns null when open=false (mounts fresh on every open)", () => {
    const { container } = render(
      <BulkEditDrawer
        open={false}
        onClose={() => undefined}
        onAfterApply={() => undefined}
        {...baseProps}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders all four field groups with their expected items", () => {
    render(
      <BulkEditDrawer
        open={true}
        onClose={() => undefined}
        onAfterApply={() => undefined}
        {...baseProps}
      />,
    )
    // Group headers visible.
    expect(screen.getByRole("button", { name: "Basic info" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Lead info" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Tags" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mailing address" })).toBeInTheDocument()
    // Sample fields from each group.
    expect(screen.getByRole("button", { name: /First name/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Type$/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Add tags/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Replace all tags/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^City$/i })).toBeInTheDocument()
  })

  it("search filters fields by label", async () => {
    const user = userEvent.setup()
    render(
      <BulkEditDrawer
        open={true}
        onClose={() => undefined}
        onAfterApply={() => undefined}
        {...baseProps}
      />,
    )
    await user.type(screen.getByLabelText(/Search fields/i), "email")
    // Wait for the 150ms debounce.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(screen.getByRole("button", { name: /Primary email/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Secondary email/i })).toBeInTheDocument()
    // Non-matching fields hidden.
    expect(screen.queryByRole("button", { name: /First name/i })).toBeNull()
  })

  it("search matches by group name too — 'address' surfaces all four Mailing fields", async () => {
    const user = userEvent.setup()
    render(
      <BulkEditDrawer
        open={true}
        onClose={() => undefined}
        onAfterApply={() => undefined}
        {...baseProps}
      />,
    )
    await user.type(screen.getByLabelText(/Search fields/i), "address")
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
    // All four mailing fields visible via group-name match.
    expect(screen.getByRole("button", { name: /Street/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^City$/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^State$/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Zip \/ Postal code/i })).toBeInTheDocument()
  })

  it("Apply button is disabled until a field is selected with a value", () => {
    render(
      <BulkEditDrawer
        open={true}
        onClose={() => undefined}
        onAfterApply={() => undefined}
        {...baseProps}
      />,
    )
    const apply = screen.getByRole("button", { name: /Apply to 3 contacts/i })
    expect(apply).toBeDisabled()
  })

  it("selecting First name + typing a value enables Apply; clicking Apply dispatches the action", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onAfterApply = vi.fn()
    render(
      <BulkEditDrawer open={true} onClose={onClose} onAfterApply={onAfterApply} {...baseProps} />,
    )
    await user.click(screen.getByRole("button", { name: /First name/i }))
    await user.type(screen.getByLabelText(/^First name$/), "Updated")
    const apply = screen.getByRole("button", { name: /Apply to 3 contacts/i })
    expect(apply).not.toBeDisabled()
    await user.click(apply)
    expect(bulkUpdateMock).toHaveBeenCalledWith({
      ids: ["c-1", "c-2", "c-3"],
      update: { kind: "firstName", value: "Updated" },
    })
    expect(onAfterApply).toHaveBeenCalled()
    expect(refreshMock).toHaveBeenCalled()
  })

  it("Replace all tags shows the destructive confirm + keeps Apply disabled until checked", async () => {
    const user = userEvent.setup()
    render(
      <BulkEditDrawer
        open={true}
        onClose={() => undefined}
        onAfterApply={() => undefined}
        {...baseProps}
      />,
    )
    await user.click(screen.getByRole("button", { name: /Replace all tags/i }))
    // Add a tag value first.
    await user.type(screen.getByPlaceholderText(/Add a tag/i), "newtag")
    await user.click(screen.getByRole("button", { name: "Add" }))
    // Even with a value, Apply stays disabled because the confirm
    // checkbox isn't checked.
    expect(screen.getByRole("button", { name: /Apply to 3 contacts/i })).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", {
        name: /This will replace all existing tags on 3 contacts/i,
      }),
    )
    expect(screen.getByRole("button", { name: /Apply to 3 contacts/i })).not.toBeDisabled()
  })
})
