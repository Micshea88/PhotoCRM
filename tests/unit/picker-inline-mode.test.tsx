/**
 * Push 3 (C6c polish #3) — `inlineMode` audit across every picker
 * used inside InlineEditSelect.
 *
 * Locked rule (docs/pathway-design-system.md §1 callout):
 *   "Every picker primitive used inside InlineEditSelect MUST
 *   support inlineMode. No borders on the trigger or search input.
 *   No shadows. No closed-state pseudo-select elements. No '— None —'
 *   indicators."
 *
 * These tests assert:
 *   - When inlineMode={true}, the rendered tree contains NO bordered
 *     class tokens on the trigger (`border-input` / `rounded-md` /
 *     `shadow` / `shadow-sm`).
 *   - When inlineMode={true}, the picker's results panel is
 *     immediately interactive (defaultOpen → options visible without
 *     a second click).
 *   - When inlineMode={true}, no element renders the "— None —"
 *     sentinel string.
 */
import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, screen } from "@testing-library/react"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { ContactRefPicker } from "@/modules/custom-fields/ui/contact-ref-picker"
import { UserRefPicker } from "@/modules/custom-fields/ui/user-ref-picker"
import { CompanyPicker } from "@/modules/companies/ui/company-picker"
import { LeadSourceCombobox } from "@/modules/contacts/ui/lead-source-combobox"

// CompanyPicker imports a server action chain; stub it so the module
// imports clean in jsdom.
vi.mock("@/modules/companies/actions", () => ({
  createCompany: () => Promise.resolve({ data: { id: "stub", name: "Stub" } }),
}))

beforeAll(() => {
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  })
})

const BORDER_FORBIDDEN = ["border-input", "rounded-md", "shadow-sm", "shadow"]

function assertNoBorderedTrigger(container: HTMLElement) {
  // Walk the rendered tree. The trigger button is the first
  // role="combobox" or role="button" descendant. Inlined search
  // inputs likewise must not carry full-border tokens.
  const trigger = container.querySelector("[role='combobox']") ?? container.querySelector("button")
  expect(trigger).not.toBeNull()
  const cls = trigger?.className ?? ""
  for (const token of BORDER_FORBIDDEN) {
    expect(
      cls.includes(token),
      `inline-mode trigger contained forbidden class "${token}" — class="${cls}"`,
    ).toBe(false)
  }
  // The "— None —" pseudo-select sentinel must NOT appear anywhere.
  expect(container.textContent).not.toMatch(/—\s*None\s*—/)
}

describe("SearchableSelect — inlineMode", () => {
  it("renders an underlined trigger without rounded/bordered chrome", () => {
    const { container } = render(
      <SearchableSelect
        items={[{ value: "a", label: "A" }]}
        value={null}
        onChange={vi.fn()}
        inlineMode
        defaultOpen
        aria-label="Pick"
      />,
    )
    assertNoBorderedTrigger(container)
  })

  it("defaultOpen renders the listbox on mount", () => {
    render(
      <SearchableSelect
        items={[{ value: "a", label: "A" }]}
        value={null}
        onChange={vi.fn()}
        defaultOpen
        inlineMode
        aria-label="Pick"
      />,
    )
    expect(screen.getByRole("listbox")).toBeInTheDocument()
  })
})

describe("SearchableMultiSelect — inlineMode", () => {
  it("strips the bordered chip-input container", () => {
    const { container } = render(
      <SearchableMultiSelect
        items={[{ value: "vip", label: "vip" }]}
        values={[]}
        onChange={vi.fn()}
        inlineMode
        defaultOpen
      />,
    )
    // The chip-input row is the first wrapping div with min-h-7 / min-h-9.
    const row = container.querySelector("div > div")
    expect(row).not.toBeNull()
    for (const token of BORDER_FORBIDDEN) {
      expect(row?.className.includes(token)).toBe(false)
    }
  })
})

describe("ContactRefPicker — inlineMode delegates to SearchableSelect", () => {
  it("renders a combobox + no '— None —' sentinel", () => {
    const { container } = render(
      <ContactRefPicker
        options={[{ id: "c1", firstName: "Alice", lastName: "A", primaryEmail: "alice@a" }]}
        value={null}
        onChange={vi.fn()}
        inlineMode
      />,
    )
    assertNoBorderedTrigger(container)
    expect(screen.queryByRole("listbox")).toBeInTheDocument()
  })
})

describe("UserRefPicker — inlineMode delegates to SearchableSelect", () => {
  it("renders without bordered chrome + no '— None —'", () => {
    const { container } = render(
      <UserRefPicker
        options={[{ id: "u1", name: "Bob", email: "bob@b" }]}
        value={null}
        onChange={vi.fn()}
        inlineMode
      />,
    )
    assertNoBorderedTrigger(container)
  })
})

describe("CompanyPicker — inlineMode delegates to SearchableSelect", () => {
  it("renders without bordered chrome + drops the + Add company button", () => {
    const { container } = render(
      <CompanyPicker
        options={[{ id: "co1", name: "Acme" }]}
        value={null}
        onChange={vi.fn()}
        inlineMode
      />,
    )
    assertNoBorderedTrigger(container)
    expect(screen.queryByRole("button", { name: /Add company/ })).not.toBeInTheDocument()
  })
})

describe("LeadSourceCombobox — inlineMode delegates to SearchableSelect", () => {
  it("renders without bordered chrome + drops the + Add new affordance", () => {
    const { container } = render(
      <LeadSourceCombobox value="" onChange={vi.fn()} existingValues={["Referral"]} inlineMode />,
    )
    assertNoBorderedTrigger(container)
    expect(container.textContent).not.toMatch(/Add new/)
  })
})
