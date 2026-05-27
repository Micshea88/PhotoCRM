/**
 * Push 3 (C3) — SearchableSelect primitive unit tests.
 *
 * Covers the contract surfaced to consumers (contact form, Bulk Edit
 * drawer, contacts filter chips): click-to-open, filter, click to
 * select, keyboard nav, ARIA roles, clear, empty state, dismissal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SearchableSelect } from "@/components/ui/searchable-select"

beforeEach(() => {
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  })
})

const ITEMS = [
  { value: "lead", label: "Lead" },
  { value: "active_client", label: "Active Client" },
  { value: "past_client", label: "Past Client" },
  { value: "vendor", label: "Vendor" },
]

describe("SearchableSelect — trigger", () => {
  it("renders the placeholder when value is null", () => {
    render(
      <SearchableSelect items={ITEMS} value={null} onChange={vi.fn()} placeholder="Pick one" />,
    )
    const trigger = screen.getByRole("combobox")
    expect(trigger).toHaveTextContent("Pick one")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
  })

  it("renders the selected label when value matches an item", () => {
    render(<SearchableSelect items={ITEMS} value="vendor" onChange={vi.fn()} />)
    expect(screen.getByRole("combobox")).toHaveTextContent("Vendor")
  })

  it("opens the listbox on click", async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={ITEMS} value={null} onChange={vi.fn()} />)
    await user.click(screen.getByRole("combobox"))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true")
  })
})

describe("SearchableSelect — filter", () => {
  it("filters items by label substring (case-insensitive)", async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={ITEMS} value={null} onChange={vi.fn()} />)
    await user.click(screen.getByRole("combobox"))
    await user.type(screen.getByPlaceholderText("Search…"), "client")
    expect(screen.getByText("Active Client")).toBeInTheDocument()
    expect(screen.getByText("Past Client")).toBeInTheDocument()
    expect(screen.queryByText("Vendor")).not.toBeInTheDocument()
  })

  it("shows emptyMessage when filter has no matches", async () => {
    const user = userEvent.setup()
    render(
      <SearchableSelect
        items={ITEMS}
        value={null}
        onChange={vi.fn()}
        emptyMessage="Nothing matches"
      />,
    )
    await user.click(screen.getByRole("combobox"))
    await user.type(screen.getByPlaceholderText("Search…"), "zzz")
    expect(screen.getByText("Nothing matches")).toBeInTheDocument()
  })
})

describe("SearchableSelect — selection", () => {
  it("calls onChange with the item value on click + closes", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableSelect items={ITEMS} value={null} onChange={onChange} />)
    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByText("Vendor"))
    expect(onChange).toHaveBeenCalledWith("vendor")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("marks the selected item with aria-selected", async () => {
    const user = userEvent.setup()
    render(<SearchableSelect items={ITEMS} value="lead" onChange={vi.fn()} />)
    await user.click(screen.getByRole("combobox"))
    const leadOption = screen.getByRole("option", { name: /Lead/ })
    expect(leadOption).toHaveAttribute("aria-selected", "true")
  })
})

describe("SearchableSelect — keyboard navigation", () => {
  it("ArrowDown + Enter selects the next item", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableSelect items={ITEMS} value={null} onChange={onChange} />)
    await user.click(screen.getByRole("combobox"))
    // First item (index 0) is the default active; ArrowDown → 1.
    const input = screen.getByPlaceholderText("Search…")
    await user.type(input, "{ArrowDown}{Enter}")
    expect(onChange).toHaveBeenCalledWith("active_client")
  })

  it("ArrowDown wraps to last and stays (no wrap-around)", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableSelect items={ITEMS} value={null} onChange={onChange} />)
    await user.click(screen.getByRole("combobox"))
    const input = screen.getByPlaceholderText("Search…")
    // Press ArrowDown 10 times — should clamp at the last item.
    await user.type(input, "{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}")
    expect(onChange).toHaveBeenCalledWith("vendor")
  })

  it("Escape closes without changing value", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableSelect items={ITEMS} value="lead" onChange={onChange} />)
    await user.click(screen.getByRole("combobox"))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("SearchableSelect — clear", () => {
  it("clear button appears only when allowClear && value is set", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <SearchableSelect items={ITEMS} value={null} onChange={onChange} allowClear />,
    )
    expect(screen.queryByLabelText("Clear selection")).not.toBeInTheDocument()
    rerender(<SearchableSelect items={ITEMS} value="vendor" onChange={onChange} allowClear />)
    const clearBtn = screen.getByLabelText("Clear selection")
    expect(clearBtn).toBeInTheDocument()
    await user.click(clearBtn)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it("clear button absent without allowClear even when value is set", () => {
    render(<SearchableSelect items={ITEMS} value="vendor" onChange={vi.fn()} />)
    expect(screen.queryByLabelText("Clear selection")).not.toBeInTheDocument()
  })
})

describe("SearchableSelect — dismiss", () => {
  it("click outside closes the listbox", async () => {
    const user = userEvent.setup()
    render(
      <>
        <div data-testid="outside">outside</div>
        <SearchableSelect items={ITEMS} value={null} onChange={vi.fn()} />
      </>,
    )
    await user.click(screen.getByRole("combobox"))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
})
