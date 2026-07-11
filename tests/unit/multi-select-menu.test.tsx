/**
 * Section 4 (D4) — MultiSelectMenu must PORTAL its option list so it isn't
 * clipped/mis-anchored inside an overflow container (the bell dropdown).
 * LAW 7: assert the observable result — the opened list escapes the scroll
 * container and lands in document.body — not merely that a prop was set.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MultiSelectMenu } from "@/components/ui/multi-select-menu"

// Radix Popover needs these pointer/scroll APIs in jsdom.
beforeEach(() => {
  if (typeof window === "undefined") return
  for (const m of ["hasPointerCapture", "releasePointerCapture", "setPointerCapture", "scrollIntoView"]) {
    Object.defineProperty(Element.prototype, m, { configurable: true, value: () => undefined })
  }
})

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
]

describe("MultiSelectMenu — portaled option list (D4)", () => {
  it("renders the options in a PORTAL that escapes an overflow container", async () => {
    const user = userEvent.setup()
    render(
      <div data-testid="scroll-container" style={{ overflow: "hidden" }}>
        <MultiSelectMenu
          label="Type"
          options={OPTIONS}
          values={[]}
          onChange={vi.fn()}
          testId="type-menu"
        />
      </div>,
    )

    await user.click(screen.getByTestId("type-menu"))

    // The list is open and its options render.
    const alpha = await screen.findByText("Alpha")
    expect(screen.getByText("Beta")).toBeInTheDocument()

    // Portaled: the opened content is NOT a descendant of the overflow container.
    const container = screen.getByTestId("scroll-container")
    expect(container.contains(alpha)).toBe(false)
  })

  it("renders section headers and type-ahead search filters options across sections (D5)", async () => {
    const user = userEvent.setup()
    render(
      <MultiSelectMenu
        label="Type"
        sections={[
          { label: "Messages & email", options: [{ value: "bounce", label: "Email bounced" }] },
          { label: "Payments", options: [{ value: "pay", label: "Payment received" }] },
        ]}
        searchable
        values={[]}
        onChange={vi.fn()}
        testId="type-menu"
      />,
    )
    await user.click(screen.getByTestId("type-menu"))

    // Section headers present (grouped, not a flat dump).
    expect(screen.getByText("Messages & email")).toBeInTheDocument()
    expect(screen.getByText("Payments")).toBeInTheDocument()
    // Grouping semantics.
    expect(screen.getAllByRole("group").length).toBe(2)

    // Type-ahead narrows to the matching option (and drops the other section).
    await user.type(screen.getByTestId("type-menu-search"), "bounce")
    expect(screen.getByText("Email bounced")).toBeInTheDocument()
    expect(screen.queryByText("Payment received")).toBeNull()

    // No matches → explicit empty state.
    await user.clear(screen.getByTestId("type-menu-search"))
    await user.type(screen.getByTestId("type-menu-search"), "zzz-nothing")
    expect(screen.getByText("No matches")).toBeInTheDocument()
  })

  it("toggles selection without closing (multi-select stays open)", async () => {
    const seen: string[][] = []
    const user = userEvent.setup()
    render(
      <MultiSelectMenu
        label="Type"
        options={OPTIONS}
        values={[]}
        onChange={(v) => seen.push(v)}
        testId="type-menu"
      />,
    )
    await user.click(screen.getByTestId("type-menu"))
    await user.click(screen.getByText("Alpha"))
    // The menu is still open after a selection (multi-select): options remain.
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    expect(screen.getByText("Beta")).toBeInTheDocument()
    expect(seen.at(-1)).toEqual(["a"])
  })
})
