/**
 * CSV V2 — inline create-field gate-transition tests.
 *
 * The MapStep's "+ Create new custom field" dropdown option puts the
 * row into a `create_new` pending state that blocks the Next button.
 * This test pins the contract that the gate re-enables on each of
 * the three resolution paths Mike specified:
 *
 *   a) The user successfully creates the field via the inline modal
 *      → row maps to cf:<newId>, intent cleared, Next re-enables.
 *   b) Instead, the user switches the dropdown to an existing field
 *      → intent cleared (setMappingAt's existing cleanup branch),
 *      Next re-enables.
 *   c) Instead, the user switches to "Don't import"
 *      → intent cleared, Next re-enables.
 *
 * Drives the wizard from Upload through Map via the real component;
 * mocks the server actions (createFieldDefinition, previewContactsImport,
 * runContactsImport, scanColumnsWithAi) so the test stays unit-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, act, type RenderResult } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ContactsImportWizard } from "@/modules/contacts/ui/contacts-import-wizard"

// Controlled URL — the wizard reads step from ?step=N via
// useSearchParams. Mocked router.push updates this closure var; the
// test's rerender() call then forces a re-render that picks up the
// new URL.
let currentSearch = ""

vi.mock("next/navigation", () => ({
  usePathname: () => "/contacts/import",
  useRouter: () => ({
    push: (url: string) => {
      const search = url.split("?")[1] ?? ""
      currentSearch = search
    },
    replace: (url: string) => {
      const search = url.split("?")[1] ?? ""
      currentSearch = search
    },
  }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}))

const previewContactsImportMock = vi.fn<(input: unknown) => unknown>()
vi.mock("@/modules/contacts/import-actions", () => ({
  previewContactsImport: (input: unknown): unknown => previewContactsImportMock(input),
  runContactsImport: vi.fn(),
}))

// AI scan: always returns the "unavailable" shape so the wizard
// falls through to alias-based mapping. Keeps the test deterministic.
vi.mock("@/modules/contacts/import-ai", () => ({
  scanColumnsWithAi: vi.fn(() => Promise.resolve({ data: null, serverError: "mocked" })),
}))

// The action under test for path (a).
const createFieldDefinitionMock = vi.fn<(input: unknown) => unknown>()
vi.mock("@/modules/custom-fields/actions", () => ({
  createFieldDefinition: (input: unknown): unknown => createFieldDefinitionMock(input),
}))

beforeEach(() => {
  currentSearch = ""
  previewContactsImportMock.mockReset()
  createFieldDefinitionMock.mockReset()
  if (typeof window !== "undefined") {
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => false,
    })
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: () => undefined,
    })
  }
})

const wizardProps = {
  currentUserId: "user-1",
  orgMembers: [{ id: "user-1", name: "Mike", email: "mike@example.com" }],
  existingTags: [],
  customFieldDefs: [],
}

/**
 * Drives the wizard from Upload (step=1) into Map (step=2) with a
 * fixture CSV. Returns the RTL render result so callers can rerender
 * after URL-driven transitions.
 *
 * The CSV deliberately includes a column ("Allergies") that the alias
 * autoMapper can't match, so the user has a clean reason to pick
 * "Create new custom field" for it.
 */
async function advanceToMapStep(user: ReturnType<typeof userEvent.setup>): Promise<RenderResult> {
  const view = render(<ContactsImportWizard {...wizardProps} />)
  const file = new File(["First Name,Last Name,Allergies\nAda,Lovelace,peanuts\n"], "test.csv", {
    type: "text/csv",
  })
  const fileInput = view.container.querySelector('input[type="file"]')
  if (!fileInput) throw new Error("file input not found in Upload step")
  await act(() => {
    fireEvent.change(fileInput, { target: { files: [file] } })
    // file.text() resolves on the next microtask — let it drain.
    return Promise.resolve()
  })
  await screen.findByText(/Parsed 1 data row · 3 columns/i)
  await user.click(screen.getByRole("button", { name: /Next: Map columns/i }))
  // Router.push updated currentSearch; rerender so useSearchParams
  // picks it up and the wizard renders the Map step.
  view.rerender(<ContactsImportWizard {...wizardProps} />)
  await screen.findByRole("heading", { name: /Map columns to contact fields/i })
  return view
}

/**
 * Find row i's "Maps to" dropdown trigger. SearchableSelect renders
 * a button with aria-label="Map column <header>".
 */
function findMapTrigger(header: string): HTMLElement {
  return screen.getByRole("combobox", { name: `Map column ${header}` })
}

/**
 * Open the Maps-to picker for `header`, then click the option whose
 * combined label+description text contains `needle`. Substring match
 * because SearchableSelect renders label AND description in the
 * same <li>, so the option's text content includes both — strict
 * accessible-name matching trips on that concatenation.
 */
async function pickMappingOption(
  user: ReturnType<typeof userEvent.setup>,
  header: string,
  needle: string,
) {
  await user.click(findMapTrigger(header))
  // Poll briefly for the portal to mount before scanning options.
  let optionEl: HTMLElement | null = null
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    const panels = document.body.querySelectorAll('[data-testid="picker-portal-panel"]')
    for (const panel of panels) {
      const options = panel.querySelectorAll<HTMLLIElement>('[role="option"]')
      for (const opt of options) {
        if (opt.textContent.includes(needle)) {
          optionEl = opt
          break
        }
      }
      if (optionEl) break
    }
    if (optionEl) break
    await new Promise((r) => setTimeout(r, 25))
  }
  if (!optionEl) {
    throw new Error(`No picker option containing "${needle}" found`)
  }
  await user.click(optionEl)
}

describe("CSV V2 — inline create-field gate transitions", () => {
  it("(a) modal create success → row maps to cf:<newId>, intent cleared, Next re-enables", async () => {
    const user = userEvent.setup()
    await advanceToMapStep(user)

    // Pick "Create new custom field" for the Allergies column.
    await pickMappingOption(user, "Allergies", "+ Create new custom field")

    // Pending state: row shows the amber hint AND Next is disabled
    // (no identifier is mapped + createNewIntent is non-empty).
    expect(screen.getByTestId("csv-v2-create-new-pending-2")).toBeInTheDocument()

    // The wizard has a baseline rule that requires an identifier to
    // be mapped before Next enables — to isolate the gate transition
    // we want to test, map a name field first so the only remaining
    // gate is the create_new intent.
    await pickMappingOption(user, "First Name", "First name")
    await pickMappingOption(user, "Last Name", "Last name")

    // Next is STILL disabled because Allergies is in create_new pending.
    const nextBtn = screen.getByRole("button", { name: /Next: Review & dedupe/i })
    expect(nextBtn).toBeDisabled()

    // Create-field modal is open for the Allergies column. Modal
    // title renders as the Modal primitive's h2; use a more specific
    // selector to disambiguate from the picker's "+ Create new
    // custom field" option which is still in the DOM.
    expect(screen.getByRole("heading", { name: /Create new custom field/i })).toBeInTheDocument()
    expect(screen.getByText(/For CSV column/i)).toHaveTextContent("Allergies")

    // Resolve via path (a): submit a successful create.
    createFieldDefinitionMock.mockResolvedValueOnce({ data: { id: "cf-new-1" } })
    const submitBtn = screen.getByTestId("csv-v2-create-field-submit")
    await user.click(submitBtn)

    // The wizard appended the new def, mapped the row to cf:cf-new-1,
    // cleared createNewIntent, and closed the modal. Next is enabled.
    expect(createFieldDefinitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recordType: "contact",
        name: "Allergies",
        fieldType: "text",
        required: false,
      }),
    )
    // Modal closed (no more Create field submit button).
    expect(screen.queryByTestId("csv-v2-create-field-submit")).toBeNull()
    // Pending amber message gone for column 2.
    expect(screen.queryByTestId("csv-v2-create-new-pending-2")).toBeNull()
    // Next button re-enabled.
    expect(screen.getByRole("button", { name: /Next: Review & dedupe/i })).not.toBeDisabled()
  })

  it("(b) switching the create_new row to an existing field → intent cleared, Next re-enables", async () => {
    const user = userEvent.setup()
    await advanceToMapStep(user)

    // First map an identifier so only the create_new intent gates Next.
    await pickMappingOption(user, "First Name", "First name")
    await pickMappingOption(user, "Last Name", "Last name")
    expect(screen.getByRole("button", { name: /Next: Review & dedupe/i })).not.toBeDisabled()

    // Now put Allergies into create_new pending.
    await pickMappingOption(user, "Allergies", "+ Create new custom field")
    expect(screen.getByTestId("csv-v2-create-new-pending-2")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Next: Review & dedupe/i })).toBeDisabled()

    // Close the modal (user backs out) — pending state PERSISTS per
    // the spec; the row only resolves via one of the three explicit
    // paths.
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByTestId("csv-v2-create-new-pending-2")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Next: Review & dedupe/i })).toBeDisabled()

    // Resolve via path (b): switch the dropdown to an existing
    // intrinsic field — Notes is a good "fits cleanly" target for
    // Allergies in a contact import.
    await pickMappingOption(user, "Allergies", "Notes")

    // Intent cleared, Next re-enabled.
    expect(screen.queryByTestId("csv-v2-create-new-pending-2")).toBeNull()
    expect(screen.getByRole("button", { name: /Next: Review & dedupe/i })).not.toBeDisabled()
  })

  it("(c) switching the create_new row to 'Don't import' → intent cleared, Next re-enables", async () => {
    const user = userEvent.setup()
    await advanceToMapStep(user)

    await pickMappingOption(user, "First Name", "First name")
    await pickMappingOption(user, "Last Name", "Last name")
    await pickMappingOption(user, "Allergies", "+ Create new custom field")
    expect(screen.getByRole("button", { name: /Next: Review & dedupe/i })).toBeDisabled()

    // Close the modal — pending persists.
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("button", { name: /Next: Review & dedupe/i })).toBeDisabled()

    // Resolve via path (c): switch to "Don't import".
    await pickMappingOption(user, "Allergies", "Don't import")

    // Intent cleared, Next re-enabled.
    expect(screen.queryByTestId("csv-v2-create-new-pending-2")).toBeNull()
    expect(screen.getByRole("button", { name: /Next: Review & dedupe/i })).not.toBeDisabled()
  })

  it("inline modal surfaces a serverError verbatim (RBAC / duplicate / collision); row stays pending", async () => {
    const user = userEvent.setup()
    await advanceToMapStep(user)
    await pickMappingOption(user, "First Name", "First name")
    await pickMappingOption(user, "Last Name", "Last name")
    await pickMappingOption(user, "Allergies", "+ Create new custom field")

    // Simulate the RBAC failure path: manager/member user, server
    // returns FORBIDDEN.
    createFieldDefinitionMock.mockResolvedValueOnce({
      serverError: "Only owners and admins can manage custom fields.",
    })
    await user.click(screen.getByTestId("csv-v2-create-field-submit"))

    // Inline error rendered verbatim. Modal stays open. Row stays in
    // create_new pending so the user can pick another resolution.
    const errBox = await screen.findByTestId("csv-v2-create-field-error")
    expect(errBox).toHaveTextContent(/Only owners and admins/i)
    expect(screen.getByTestId("csv-v2-create-field-submit")).toBeInTheDocument()
    expect(screen.getByTestId("csv-v2-create-new-pending-2")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Next: Review & dedupe/i })).toBeDisabled()
  })
})
