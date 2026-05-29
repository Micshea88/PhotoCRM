/**
 * Push 3 (C6c polish) — InlineEditSelect primitive tests.
 *
 * Same lifecycle contract as InlineEditField (autosave on
 * selection or blur, Esc reverts, NO Save/Cancel buttons). The
 * picker varies — default SearchableSelect when `items` is supplied,
 * custom via `renderPicker` for Owner / Company.
 */
import { describe, it, expect, vi, beforeAll } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { InlineEditSelect } from "@/components/ui/inline-edit-select"

const ITEMS = [
  { value: "Lead", label: "Lead" },
  { value: "Vendor", label: "Vendor" },
  { value: "Active Client", label: "Active Client" },
]

beforeAll(() => {
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  })
})

describe("InlineEditSelect — read mode", () => {
  it("shows displayLabel", () => {
    render(<InlineEditSelect value="Lead" displayLabel="Lead" items={ITEMS} onSave={vi.fn()} />)
    expect(screen.getByText("Lead")).toBeInTheDocument()
  })

  it("shows placeholder when displayLabel is null", () => {
    render(
      <InlineEditSelect
        value={null}
        displayLabel={null}
        items={ITEMS}
        onSave={vi.fn()}
        placeholder="(unset)"
      />,
    )
    expect(screen.getByText("(unset)")).toBeInTheDocument()
  })
})

describe("InlineEditSelect — autosave on selection", () => {
  it("selecting a SearchableSelect item triggers onSave with the new value", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve(undefined))
    render(
      <InlineEditSelect
        value="Lead"
        displayLabel="Lead"
        items={ITEMS}
        onSave={onSave}
        ariaLabel="Type"
      />,
    )
    await user.click(screen.getByRole("button", { name: "Type" }))
    // SearchableSelect opens; click "Vendor".
    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByText("Vendor"))
    expect(onSave).toHaveBeenCalledWith("Vendor")
  })
})

describe("InlineEditSelect — Esc reverts", () => {
  it("Escape closes without calling onSave", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <InlineEditSelect
        value="Lead"
        displayLabel="Lead"
        items={ITEMS}
        onSave={onSave}
        ariaLabel="Type"
      />,
    )
    await user.click(screen.getByRole("button", { name: "Type" }))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText("Lead")).toBeInTheDocument()
  })
})

describe("InlineEditSelect — renderPicker custom picker", () => {
  it("custom picker calls commit() → triggers onSave", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve(undefined))
    render(
      <InlineEditSelect
        value={null}
        displayLabel={null}
        onSave={onSave}
        ariaLabel="Owner"
        renderPicker={({ commit }) => (
          <button
            type="button"
            onClick={() => {
              void commit("user-42")
            }}
            data-testid="custom-pick"
          >
            Pick Alice
          </button>
        )}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Owner" }))
    await user.click(screen.getByTestId("custom-pick"))
    expect(onSave).toHaveBeenCalledWith("user-42")
  })
})

describe("InlineEditSelect — error path", () => {
  it("onSave { error } surfaces inline + stays in edit mode", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve({ error: "Server says no." }))
    render(
      <InlineEditSelect
        value="Lead"
        displayLabel="Lead"
        items={ITEMS}
        onSave={onSave}
        ariaLabel="Type"
      />,
    )
    await user.click(screen.getByRole("button", { name: "Type" }))
    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByText("Vendor"))
    expect(await screen.findByText("Server says no.")).toBeInTheDocument()
  })
})
