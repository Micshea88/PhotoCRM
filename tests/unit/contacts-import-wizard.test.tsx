/**
 * Push 2c.2.2 — wizard navigation + Cancel-on-Preview tests.
 *
 *   - URL-driven step: rendering at ?step=N shows the matching step
 *     when the React data backing that step exists; redirects to a
 *     reason=state_lost variant when the data is missing.
 *   - Cancel button on the Preview step exits to /contacts.
 *
 * Server actions + Next router are mocked. The component test
 * verifies the UI contract; the wizard's deeper data flow has its
 * own coverage in tests/unit/contacts-import-spec.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ContactsImportWizard } from "@/modules/contacts/ui/contacts-import-wizard"

// Capture router calls so tests can assert navigation.
const routerPush = vi.fn()
const routerReplace = vi.fn()
let currentSearch = ""

vi.mock("next/navigation", () => ({
  usePathname: () => "/contacts/import",
  useRouter: () => ({
    push: (...args: unknown[]) => {
      routerPush(...args)
    },
    replace: (...args: unknown[]) => {
      routerReplace(...args)
    },
  }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}))

vi.mock("@/modules/contacts/import-actions", () => ({
  previewContactsImport: vi.fn(),
  runContactsImport: vi.fn(),
}))

// CSV V2 — import-ai.ts has "use server" + transitively pulls
// @/lib/db. Stub the action surface so jsdom doesn't try to
// evaluate the server-only env. The wizard's AI handler always
// runs the safe-fallback path under this mock (no suggestions),
// which matches the AI-unavailable runtime behavior.
vi.mock("@/modules/contacts/import-ai", () => ({
  scanColumnsWithAi: vi.fn(() => Promise.resolve({ data: null, serverError: "mocked" })),
}))

// CSV V2 — the inline create-field modal imports createFieldDefinition
// from "use server" custom-fields/actions which transitively pulls
// @/lib/db. Stub it for unit tests so jsdom doesn't evaluate the
// server-only env. These tests don't drive the modal; the dedicated
// gate-transition tests in csv-v2-create-field-resolution.test.tsx do.
vi.mock("@/modules/custom-fields/actions", () => ({
  createFieldDefinition: vi.fn(() => Promise.resolve({ data: null, serverError: "mocked" })),
}))

beforeEach(() => {
  routerPush.mockClear()
  routerReplace.mockClear()
  currentSearch = ""
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
  currentUserId: "user-1",
  orgMembers: [{ id: "user-1", name: "Mike", email: "mike@example.com" }],
  existingTags: ["vip"],
  customFieldDefs: [],
}

describe("ContactsImportWizard — step rendering by ?step= URL param", () => {
  it("?step missing → renders Upload step", () => {
    render(<ContactsImportWizard {...baseProps} />)
    expect(screen.getByRole("heading", { name: /upload csv/i })).toBeInTheDocument()
  })

  it("?step=1 → renders Upload step", () => {
    currentSearch = "step=1"
    render(<ContactsImportWizard {...baseProps} />)
    expect(screen.getByRole("heading", { name: /upload csv/i })).toBeInTheDocument()
  })

  it("?step=2 without uploaded CSV → redirects to step=1 with reason=state_lost", () => {
    currentSearch = "step=2"
    render(<ContactsImportWizard {...baseProps} />)
    // The wizard renders BEFORE the effect fires, so the Map step
    // briefly tries to render (and bails because parsed is null);
    // the effect's redirect is the assertable signal.
    expect(routerReplace).toHaveBeenCalledWith("/contacts/import?step=1&reason=state_lost")
  })

  it("?step=3 without preview rows → redirects to step=1 with reason=state_lost", () => {
    currentSearch = "step=3"
    render(<ContactsImportWizard {...baseProps} />)
    expect(routerReplace).toHaveBeenCalledWith("/contacts/import?step=1&reason=state_lost")
  })

  it("?step=4 without import result → redirects to step=1 with reason=state_lost", () => {
    currentSearch = "step=4"
    render(<ContactsImportWizard {...baseProps} />)
    expect(routerReplace).toHaveBeenCalledWith("/contacts/import?step=1&reason=state_lost")
  })

  it("?step=1&reason=state_lost → renders Upload step + amber state-lost notice", () => {
    currentSearch = "step=1&reason=state_lost"
    render(<ContactsImportWizard {...baseProps} />)
    expect(screen.getByRole("heading", { name: /upload csv/i })).toBeInTheDocument()
    expect(screen.getByText(/Wizard state was lost/i)).toBeInTheDocument()
  })

  it("invalid ?step value → falls back to Upload step", () => {
    currentSearch = "step=banana"
    render(<ContactsImportWizard {...baseProps} />)
    expect(screen.getByRole("heading", { name: /upload csv/i })).toBeInTheDocument()
  })

  it("?step=99 (out-of-range) → falls back to Upload step", () => {
    currentSearch = "step=99"
    render(<ContactsImportWizard {...baseProps} />)
    expect(screen.getByRole("heading", { name: /upload csv/i })).toBeInTheDocument()
  })
})

describe("ContactsImportWizard — Step numbering", () => {
  it("Stepper labels are 1. Upload, 2. Map fields, 3. Preview & dedupe, 4. Import", () => {
    render(<ContactsImportWizard {...baseProps} />)
    const stepper = screen.getByRole("list")
    expect(stepper.textContent).toContain("1. Upload")
    expect(stepper.textContent).toContain("2. Map fields")
    expect(stepper.textContent).toContain("3. Preview & dedupe")
    expect(stepper.textContent).toContain("4. Import")
  })
})
