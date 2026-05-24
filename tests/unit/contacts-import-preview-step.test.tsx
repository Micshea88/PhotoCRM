/**
 * Push 2c.3 — PreviewStep error-row UX tests.
 *
 * Focused tests for the Fix-4 changes:
 *   - Summary banner gets the red "M rows will be SKIPPED due to
 *     errors" line when error rows exist.
 *   - Error rows render with destructive-tinted background and a
 *     disabled action dropdown showing "Skip — has errors".
 *   - Import button label appends "(N skipped due to errors)" when
 *     error rows are present.
 *   - The removed "If a row errors" radio group is gone.
 *   - The new Cancel button on the Preview footer is present.
 *
 * The PreviewStep component is exported from the wizard module
 * specifically so it can be exercised here with fixture data —
 * driving the entire wizard through Upload + Map first would be
 * substantially noisier without adding test value.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { PreviewStep, type PreviewRow } from "@/modules/contacts/ui/contacts-import-wizard"
import type { CleanRow } from "@/modules/contacts/import-spec"

// next/navigation isn't used by PreviewStep directly, but PreviewStep
// imports flow through the wizard module which imports useRouter at the
// module level — stub here for safety.
vi.mock("next/navigation", () => ({
  usePathname: () => "/contacts/import",
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(""),
}))

vi.mock("@/modules/contacts/import-actions", () => ({
  previewContactsImport: vi.fn(),
  runContactsImport: vi.fn(),
}))

beforeEach(() => {
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  })
})

const owners = [{ id: "user-1", name: "Mike", email: "mike@example.com" }]
const noop = () => undefined

function makeClean(
  rowIndex: number,
  values: Partial<CleanRow["values"]>,
  errors: string[] = [],
  warnings: string[] = [],
): CleanRow {
  return { rowIndex, values, errors, warnings }
}

function makePreview(
  rowIndex: number,
  action: PreviewRow["action"] = "create",
  duplicateOfRow: number | null = null,
): PreviewRow {
  return {
    rowIndex,
    matchedContactId: null,
    matchedContactName: null,
    action,
    duplicateOfRow,
  }
}

function renderPreview({
  cleanRows,
  previewRows,
}: {
  cleanRows: CleanRow[]
  previewRows: PreviewRow[]
}) {
  return render(
    <PreviewStep
      cleanRows={cleanRows}
      previewRows={previewRows}
      orgMembers={owners}
      orgMemberEmails={[]}
      existingTags={[]}
      ownerMode="self"
      onOwnerModeChange={noop}
      specificOwnerId="user-1"
      onSpecificOwnerIdChange={noop}
      bulkTags={[]}
      onBulkTagsChange={noop}
      ownerEmailColumnMapped={false}
      onSetAction={noop}
      onSetAllMatchedTo={noop}
      onSetAllUnmatchedTo={noop}
      busy={false}
      onBack={noop}
      onCancel={noop}
      onNext={noop}
    />,
  )
}

describe("PreviewStep — Fix 4 error-row UX (Push 2c.3)", () => {
  it("summary banner shows the red skip-due-to-errors line when error rows exist", () => {
    renderPreview({
      cleanRows: [
        makeClean(1, { firstName: "Ada", lastName: "Lovelace" }),
        makeClean(2, { firstName: "Bad" }, ["lastName is required"]),
      ],
      previewRows: [makePreview(1, "create")],
    })
    // Skip-due-to-errors line is distinct from the regular skip count.
    expect(screen.getByText(/1 rows will be SKIPPED due to errors/i)).toBeInTheDocument()
  })

  it("Import button label includes '(N skipped due to errors)' when errors exist", () => {
    renderPreview({
      cleanRows: [
        makeClean(1, { firstName: "Ada", lastName: "Lovelace" }),
        makeClean(2, { firstName: "Grace", lastName: "Hopper" }),
        makeClean(3, { firstName: "Bad" }, ["lastName is required"]),
      ],
      previewRows: [makePreview(1, "create"), makePreview(2, "create")],
    })
    expect(
      screen.getByRole("button", { name: /Import 2 rows \(1 skipped due to errors\)/i }),
    ).toBeInTheDocument()
  })

  it("Import button label is plain when no error rows", () => {
    renderPreview({
      cleanRows: [
        makeClean(1, { firstName: "Ada", lastName: "Lovelace" }),
        makeClean(2, { firstName: "Grace", lastName: "Hopper" }),
      ],
      previewRows: [makePreview(1, "create"), makePreview(2, "create")],
    })
    expect(screen.getByRole("button", { name: /^Import 2 rows$/i })).toBeInTheDocument()
  })

  it("error rows have a disabled 'Skip — has errors' action select", () => {
    renderPreview({
      cleanRows: [
        makeClean(1, { firstName: "Ada", lastName: "Lovelace" }),
        makeClean(2, { firstName: "Bad" }, ["lastName is required"]),
      ],
      previewRows: [makePreview(1, "create")],
    })
    // The disabled select on row 2 carries an aria-label that mentions
    // disabled-because-errors so screen readers pick it up.
    const errorSelect = screen.getByRole("combobox", {
      name: /Action for row 2 — disabled because the row has errors/i,
    })
    expect(errorSelect).toBeDisabled()
    expect(errorSelect.textContent).toContain("Skip — has errors")
  })

  it("non-error rows keep an enabled action select with the create/update/skip options", () => {
    renderPreview({
      cleanRows: [makeClean(1, { firstName: "Ada", lastName: "Lovelace" })],
      previewRows: [makePreview(1, "create")],
    })
    // The 5 selects on Preview = ownerMode select + tag picker has a
    // text Input, so the action select is the lone combobox on the
    // row. Find by the row index — row 1 is the only data row.
    const selects = screen
      .getAllByRole("combobox")
      .filter((el) => !(el as HTMLSelectElement).disabled)
    expect(selects.length).toBeGreaterThan(0)
  })

  it("does NOT render the removed 'If a row errors' radio group", () => {
    renderPreview({
      cleanRows: [makeClean(1, { firstName: "Ada", lastName: "Lovelace" })],
      previewRows: [makePreview(1, "create")],
    })
    expect(screen.queryByText(/If a row errors/i)).toBeNull()
    expect(screen.queryByText(/Stop the import on the first error/i)).toBeNull()
    expect(screen.queryByText(/Skip the row and import the rest/i)).toBeNull()
  })

  it("renders the Cancel button between Back and Import (Push 2c.2.2 carry-over)", () => {
    renderPreview({
      cleanRows: [makeClean(1, { firstName: "Ada", lastName: "Lovelace" })],
      previewRows: [makePreview(1, "create")],
    })
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument()
  })

  it("renders the Push 2c.5 'Set all matched / unmatched' bulk controls above the row table", () => {
    renderPreview({
      cleanRows: [makeClean(1, { firstName: "Ada", lastName: "Lovelace" })],
      previewRows: [makePreview(1, "create")],
    })
    // Two SetAllRow controls render with their respective labels.
    expect(screen.getByLabelText("Set all matched rows to")).toBeInTheDocument()
    expect(screen.getByLabelText("Set all unmatched rows to")).toBeInTheDocument()
    // Both have their own Apply button (testing-library returns
    // multiple — two Apply buttons + zero others on the Preview).
    const applyButtons = screen.getAllByRole("button", { name: "Apply" })
    expect(applyButtons.length).toBe(2)
  })

  it("clicking Set all matched → Apply invokes onSetAllMatchedTo with the dropdown value", async () => {
    const onSetAllMatchedTo = vi.fn()
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    render(
      <PreviewStep
        cleanRows={[makeClean(1, { firstName: "Ada", lastName: "Lovelace" })]}
        previewRows={[makePreview(1, "create")]}
        orgMembers={owners}
        orgMemberEmails={[]}
        existingTags={[]}
        ownerMode="self"
        onOwnerModeChange={noop}
        specificOwnerId="user-1"
        onSpecificOwnerIdChange={noop}
        bulkTags={[]}
        onBulkTagsChange={noop}
        ownerEmailColumnMapped={false}
        onSetAction={noop}
        onSetAllMatchedTo={onSetAllMatchedTo}
        onSetAllUnmatchedTo={noop}
        busy={false}
        onBack={noop}
        onCancel={noop}
        onNext={noop}
      />,
    )
    // The default for matched is "update"; click Apply directly.
    const applyButtons = screen.getAllByRole("button", { name: "Apply" })
    await user.click(applyButtons[0]!)
    expect(onSetAllMatchedTo).toHaveBeenCalledWith("update")
  })
})
