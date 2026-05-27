/**
 * Push 3 (C3) — SearchableMultiSelect primitive unit tests.
 *
 * Covers chip rendering, chip removal, filter behavior (selected items
 * hidden from suggestions), allowCreate flow with lowercase+trim
 * normalization, backspace-on-empty removes last chip, comma
 * separator triggers create.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"

beforeEach(() => {
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  })
})

const TAG_ITEMS = [
  { value: "vip", label: "vip" },
  { value: "studio-friend", label: "studio-friend" },
  { value: "wedding", label: "wedding" },
  { value: "newborn", label: "newborn" },
]

describe("SearchableMultiSelect — chip rendering", () => {
  it("renders nothing visible besides the placeholder when values are empty", () => {
    render(
      <SearchableMultiSelect
        items={TAG_ITEMS}
        values={[]}
        onChange={vi.fn()}
        placeholder="Add tag…"
      />,
    )
    expect(screen.getByPlaceholderText("Add tag…")).toBeInTheDocument()
  })

  it("renders a chip per value", () => {
    render(
      <SearchableMultiSelect items={TAG_ITEMS} values={["vip", "wedding"]} onChange={vi.fn()} />,
    )
    expect(screen.getByText("vip")).toBeInTheDocument()
    expect(screen.getByText("wedding")).toBeInTheDocument()
  })

  it("X on a chip removes it via onChange (without the removed value)", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SearchableMultiSelect items={TAG_ITEMS} values={["vip", "wedding"]} onChange={onChange} />,
    )
    await user.click(screen.getByLabelText("Remove vip"))
    expect(onChange).toHaveBeenCalledWith(["wedding"])
  })
})

describe("SearchableMultiSelect — filter + selection", () => {
  it("hides already-selected items from suggestions", async () => {
    const user = userEvent.setup()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={["vip"]} onChange={vi.fn()} />)
    await user.click(screen.getByRole("combobox"))
    const listbox = screen.getByRole("listbox")
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (el) => el.textContent,
    )
    // Selected value 'vip' is hidden from the dropdown; other tags appear.
    expect(labels).not.toContain("vip")
    expect(labels).toContain("studio-friend")
    expect(labels).toContain("wedding")
  })

  it("filters by label substring", async () => {
    const user = userEvent.setup()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={[]} onChange={vi.fn()} />)
    const input = screen.getByRole("combobox")
    await user.click(input)
    await user.type(input, "wed")
    const listbox = screen.getByRole("listbox")
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (el) => el.textContent,
    )
    expect(labels).toContain("wedding")
    expect(labels).not.toContain("vip")
  })

  it("clicking a suggestion adds it via onChange", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={["vip"]} onChange={onChange} />)
    await user.click(screen.getByRole("combobox"))
    await user.click(screen.getByText("wedding"))
    expect(onChange).toHaveBeenCalledWith(["vip", "wedding"])
  })
})

describe("SearchableMultiSelect — allowCreate", () => {
  it("shows create row when query has no exact match", async () => {
    const user = userEvent.setup()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={[]} onChange={vi.fn()} allowCreate />)
    await user.click(screen.getByRole("combobox"))
    await user.type(screen.getByRole("combobox"), "shoot")
    expect(screen.getByText(/Create "shoot"/)).toBeInTheDocument()
  })

  it("does NOT show create row when query matches an existing item exactly", async () => {
    const user = userEvent.setup()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={[]} onChange={vi.fn()} allowCreate />)
    await user.click(screen.getByRole("combobox"))
    await user.type(screen.getByRole("combobox"), "vip")
    expect(screen.queryByText(/Create "vip"/)).not.toBeInTheDocument()
  })

  it("creates a normalized (lowercase+trim) value when create row is clicked", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={[]} onChange={onChange} allowCreate />)
    await user.click(screen.getByRole("combobox"))
    await user.type(screen.getByRole("combobox"), "  Newbie  ")
    await user.click(screen.getByText(/Create "Newbie"/))
    expect(onChange).toHaveBeenCalledWith(["newbie"])
  })

  it("Enter on the create row also creates", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={[]} onChange={onChange} allowCreate />)
    const input = screen.getByRole("combobox")
    await user.click(input)
    await user.type(input, "Outdoor")
    // No matching item → create row is the only navigable row at index 0.
    await user.type(input, "{Enter}")
    expect(onChange).toHaveBeenCalledWith(["outdoor"])
  })

  it("comma triggers create when query has no exact match", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={[]} onChange={onChange} allowCreate />)
    const input = screen.getByRole("combobox")
    await user.click(input)
    await user.type(input, "engagement,")
    expect(onChange).toHaveBeenCalledWith(["engagement"])
  })
})

describe("SearchableMultiSelect — backspace removes last chip", () => {
  it("Backspace on empty input removes the last value", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SearchableMultiSelect items={TAG_ITEMS} values={["vip", "wedding"]} onChange={onChange} />,
    )
    const input = screen.getByRole("combobox")
    await user.click(input)
    await user.type(input, "{Backspace}")
    expect(onChange).toHaveBeenCalledWith(["vip"])
  })

  it("Backspace with text in input does NOT remove a chip", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={["vip"]} onChange={onChange} />)
    const input = screen.getByRole("combobox")
    await user.click(input)
    await user.type(input, "abc{Backspace}")
    // The text-deletion happens; no chip removed.
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("SearchableMultiSelect — dismiss", () => {
  it("Escape closes the panel", async () => {
    const user = userEvent.setup()
    render(<SearchableMultiSelect items={TAG_ITEMS} values={[]} onChange={vi.fn()} />)
    await user.click(screen.getByRole("combobox"))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("click outside closes the panel", async () => {
    const user = userEvent.setup()
    render(
      <>
        <div data-testid="outside">outside</div>
        <SearchableMultiSelect items={TAG_ITEMS} values={[]} onChange={vi.fn()} />
      </>,
    )
    await user.click(screen.getByRole("combobox"))
    fireEvent.mouseDown(screen.getByTestId("outside"))
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
})
