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
    const list = await screen.findByRole("listbox")
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    expect(screen.getByText("Beta")).toBeInTheDocument()

    // Portaled: the list is NOT a descendant of the overflow container.
    const container = screen.getByTestId("scroll-container")
    expect(container.contains(list)).toBe(false)
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
    // The list is still open after a selection (multi-select).
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(seen.at(-1)).toEqual(["a"])
  })
})
