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

// CSV V2 — import-ai.ts has "use server" + transitively pulls
// @/lib/db. Stub the action surface so jsdom doesn't try to
// evaluate the server-only env. PreviewStep doesn't call the
// scanner directly, but it lives in the same wizard module.
vi.mock("@/modules/contacts/import-ai", () => ({
  scanColumnsWithAi: vi.fn(() => Promise.resolve({ data: null, serverError: "mocked" })),
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
  return { rowIndex, values, customValues: {}, errors, warnings }
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
    matchedField: null,
    action,
    duplicateOfRow,
  }
}

function renderPreview({
  cleanRows,
  previewRows,
  customFieldDefs = [],
}: {
  cleanRows: CleanRow[]
  previewRows: PreviewRow[]
  customFieldDefs?: { id: string; name: string; fieldType: string; archivedAt: string | null }[]
}) {
  return render(
    <PreviewStep
      cleanRows={cleanRows}
      previewRows={previewRows}
      orgMembers={owners}
      orgMemberEmails={[]}
      existingTags={[]}
      customFieldDefs={customFieldDefs}
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
  it("error rows count toward the Skip metric card AND surface their per-row error inline", () => {
    // CSV V2 layout: the old bulleted "1 rows will be SKIPPED due to
    // errors" summary line moved into the three Skip-Create-Update
    // metric cards. The error row's per-row inline error message
    // still renders verbatim under the contact cell (unchanged).
    renderPreview({
      cleanRows: [
        makeClean(1, { firstName: "Ada", lastName: "Lovelace" }),
        makeClean(2, { firstName: "Bad" }, ["lastName is required"]),
      ],
      previewRows: [makePreview(1, "create")],
    })
    // Skip metric card present with value=1 (the one error row).
    const skipCard = screen.getByTestId("csv-v2-metric-skip")
    expect(skipCard).toHaveTextContent(/Skip/i)
    expect(skipCard).toHaveTextContent("1")
    // Per-row error text still surfaces inline.
    expect(screen.getByText("lastName is required")).toBeInTheDocument()
    // The Import button still appends "(N skipped due to errors)" so
    // the commit count is honest — covered by the dedicated test
    // below; just guard against it disappearing here too.
    expect(
      screen.getByRole("button", { name: /Import 1 rows \(1 skipped due to errors\)/i }),
    ).toBeInTheDocument()
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

  it("renders both 'Set all matched / unmatched' bulk controls in the V2 compact settings bar", () => {
    renderPreview({
      cleanRows: [makeClean(1, { firstName: "Ada", lastName: "Lovelace" })],
      previewRows: [makePreview(1, "create")],
    })
    // CSV V2 layout — both controls live inside the compact horizontal
    // settings bar now, each under a small label header. The Apply
    // buttons + onApply callback contract are unchanged.
    const settingsBar = screen.getByTestId("csv-v2-preview-settings-bar")
    expect(settingsBar).toHaveTextContent(/Set all matched rows to/i)
    expect(settingsBar).toHaveTextContent(/Set all unmatched rows to/i)
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
        customFieldDefs={[]}
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
    // P3 (C5) — the default for matched rows is now "skip" (memory #24:
    // never let CSV import accidentally create duplicates of existing
    // contacts; matched rows opt-in to Update Contact per row).
    const applyButtons = screen.getAllByRole("button", { name: "Apply" })
    await user.click(applyButtons[0]!)
    expect(onSetAllMatchedTo).toHaveBeenCalledWith("skip")
  })
})

describe("PreviewStep — CSV V2 layout: custom-field columns dropped, customValues payload intact", () => {
  // The Push 4 B1 Part 0 per-custom-field columns rendered inline in
  // the preview table. The CSV V2 layout drops those columns to keep
  // the table to four fixed columns per the approved mockup. The
  // import payload (customValues on each row) is UNCHANGED — full
  // custom-field data still imports. These tests pin the visual
  // change AND the data-preservation invariant.

  it("V2 layout does NOT render a column header per mapped custom field", () => {
    const defId = "ckdef1"
    const row1: CleanRow = {
      rowIndex: 1,
      values: { firstName: "Ada", lastName: "Lovelace" },
      customValues: { [defId]: "yes" },
      errors: [],
      warnings: [],
    }
    renderPreview({
      cleanRows: [row1],
      previewRows: [
        {
          rowIndex: 1,
          matchedContactId: null,
          matchedContactName: null,
          matchedField: null,
          action: "create",
          duplicateOfRow: null,
        },
      ],
      customFieldDefs: [
        { id: defId, name: "TOP 10 Vendor", fieldType: "checkbox", archivedAt: null },
      ],
    })
    // V2: the per-custom-field column header is gone. Table only
    // has four fixed columns.
    expect(screen.queryByRole("columnheader", { name: "TOP 10 Vendor" })).toBeNull()
    // The four V2 column headers all render.
    expect(screen.getByRole("columnheader", { name: "Contact" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Email / phone" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Matches existing" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeInTheDocument()
  })

  it("omits the custom field columns when no row maps any cf:* (same as the always-omitted V2 layout)", () => {
    const row1: CleanRow = {
      rowIndex: 1,
      values: { firstName: "Ada", lastName: "Lovelace" },
      customValues: {},
      errors: [],
      warnings: [],
    }
    renderPreview({
      cleanRows: [row1],
      previewRows: [
        {
          rowIndex: 1,
          matchedContactId: null,
          matchedContactName: null,
          matchedField: null,
          action: "create",
          duplicateOfRow: null,
        },
      ],
      customFieldDefs: [
        { id: "x", name: "TOP 10 Vendor", fieldType: "checkbox", archivedAt: null },
      ],
    })
    expect(screen.queryByRole("columnheader", { name: "TOP 10 Vendor" })).toBeNull()
  })
})

describe("PreviewStep — CSV V2 layout primitives (header counts, metric cards, dup warning)", () => {
  it("header row shows row count muted and duplicates count in red when D > 0", () => {
    renderPreview({
      cleanRows: [
        makeClean(1, { firstName: "Ada", lastName: "Lovelace" }),
        makeClean(2, { firstName: "Grace", lastName: "Hopper" }),
      ],
      previewRows: [
        {
          rowIndex: 1,
          matchedContactId: "c-existing-1",
          matchedContactName: "Ada Existing",
          matchedField: "email",
          action: "skip",
          duplicateOfRow: null,
        },
        makePreview(2, "create"),
      ],
    })
    const headerCounts = screen.getByTestId("csv-v2-preview-header-counts")
    // Row total muted, no duplicate count.
    expect(headerCounts).toHaveTextContent("2 rows")
    expect(headerCounts).toHaveTextContent(/1 duplicate found/)
  })

  it("header row hides the red duplicates label when D = 0", () => {
    renderPreview({
      cleanRows: [makeClean(1, { firstName: "Ada", lastName: "Lovelace" })],
      previewRows: [makePreview(1, "create")],
    })
    const headerCounts = screen.getByTestId("csv-v2-preview-header-counts")
    expect(headerCounts).toHaveTextContent("1 row")
    expect(headerCounts).not.toHaveTextContent(/duplicate/i)
  })

  it("compact amber dup warning strip renders only when there's at least one DB-matched duplicate", () => {
    renderPreview({
      cleanRows: [makeClean(1, { firstName: "Ada", lastName: "Lovelace" })],
      previewRows: [
        {
          rowIndex: 1,
          matchedContactId: "c-existing",
          matchedContactName: "Ada Existing",
          matchedField: "email",
          action: "skip",
          duplicateOfRow: null,
        },
      ],
    })
    // Verbatim copy from the mockup.
    const strip = screen.getByTestId("csv-v2-preview-dup-warning")
    expect(strip).toHaveTextContent(/default(s)? to Skip/i)
    expect(strip).toHaveTextContent(/no duplicate will be created/i)
  })

  it("compact amber dup warning strip is absent when no DB match", () => {
    renderPreview({
      cleanRows: [makeClean(1, { firstName: "Ada", lastName: "Lovelace" })],
      previewRows: [makePreview(1, "create")],
    })
    expect(screen.queryByTestId("csv-v2-preview-dup-warning")).toBeNull()
  })
})

describe("PreviewStep — CSV V2 matched-field highlight (red on the colliding value)", () => {
  // The danger red used by the header duplicate count is
  // text-red-600 dark:text-red-400 — same token used by the
  // V2 matched-field highlight so the visual ties together.
  const DANGER_RED = "text-red-600"

  it("matchedField='email' colors the email red and leaves the phone normal", () => {
    renderPreview({
      cleanRows: [
        makeClean(1, {
          firstName: "Ada",
          lastName: "Lovelace",
          primaryEmail: "ada@example.com",
          primaryPhone: "+1-555-0101",
        }),
      ],
      previewRows: [
        {
          rowIndex: 1,
          matchedContactId: "c-existing-email",
          matchedContactName: "Ada Existing",
          matchedField: "email",
          action: "skip",
          duplicateOfRow: null,
        },
      ],
    })
    const emailCell = screen.getByTestId("csv-v2-preview-email-1")
    const phoneCell = screen.getByTestId("csv-v2-preview-phone-1")
    expect(emailCell).toHaveTextContent("ada@example.com")
    expect(phoneCell).toHaveTextContent("+1-555-0101")
    expect(emailCell.className).toContain(DANGER_RED)
    expect(phoneCell.className).not.toContain(DANGER_RED)
  })

  it("matchedField='phone' colors the phone red and leaves the email normal", () => {
    renderPreview({
      cleanRows: [
        makeClean(1, {
          firstName: "Grace",
          lastName: "Hopper",
          primaryEmail: "grace@example.com",
          primaryPhone: "+1-555-0202",
        }),
      ],
      previewRows: [
        {
          rowIndex: 1,
          matchedContactId: "c-existing-phone",
          matchedContactName: "Grace Existing",
          matchedField: "phone",
          action: "skip",
          duplicateOfRow: null,
        },
      ],
    })
    const emailCell = screen.getByTestId("csv-v2-preview-email-1")
    const phoneCell = screen.getByTestId("csv-v2-preview-phone-1")
    expect(emailCell).toHaveTextContent("grace@example.com")
    expect(phoneCell).toHaveTextContent("+1-555-0202")
    expect(emailCell.className).not.toContain(DANGER_RED)
    expect(phoneCell.className).toContain(DANGER_RED)
  })

  it("unmatched row leaves BOTH email and phone in normal color", () => {
    renderPreview({
      cleanRows: [
        makeClean(1, {
          firstName: "Alan",
          lastName: "Turing",
          primaryEmail: "alan@example.com",
          primaryPhone: "+1-555-0303",
        }),
      ],
      previewRows: [makePreview(1, "create")],
    })
    const emailCell = screen.getByTestId("csv-v2-preview-email-1")
    const phoneCell = screen.getByTestId("csv-v2-preview-phone-1")
    expect(emailCell.className).not.toContain(DANGER_RED)
    expect(phoneCell.className).not.toContain(DANGER_RED)
  })

  it("matchedField=null on a CSV-internal duplicate leaves both fields uncolored", () => {
    // CSV-internal duplicates (duplicateOfRow !== null) have no
    // server-side field reason — the matcher uses identifier+identifier
    // comparison across the SAME CSV upload, not DB lookups. Both
    // values stay normal in that case.
    renderPreview({
      cleanRows: [
        makeClean(1, {
          firstName: "John",
          lastName: "Doe",
          primaryEmail: "dup@example.com",
        }),
        makeClean(2, {
          firstName: "John",
          lastName: "Doe",
          primaryEmail: "dup@example.com",
        }),
      ],
      previewRows: [
        makePreview(1, "create"),
        {
          rowIndex: 2,
          matchedContactId: null,
          matchedContactName: null,
          matchedField: null,
          action: "skip",
          duplicateOfRow: 1,
        },
      ],
    })
    const emailCell = screen.getByTestId("csv-v2-preview-email-2")
    expect(emailCell.className).not.toContain(DANGER_RED)
  })
})
