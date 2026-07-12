/**
 * Tests for the shared Tooltip primitive. It is now a PORTALED, collision-aware
 * Radix tooltip (so it can't be clipped by an overflow container such as the bell
 * dropdown). The child is always rendered; the label mounts on hover / keyboard
 * focus and is portaled out to document.body.
 */
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Tooltip } from "@/components/ui/tooltip"

describe("Tooltip", () => {
  it("renders the wrapped child, and reveals the portaled label on focus", async () => {
    render(
      <div data-testid="clip" className="overflow-y-auto">
        <Tooltip label="Mike Shea">
          <button type="button">child</button>
        </Tooltip>
      </div>,
    )
    // Child is always present.
    expect(screen.getByText("child")).toBeInTheDocument()

    // Radix opens the tooltip on keyboard focus (no hover delay for focus).
    // React delegates onFocus via the bubbling focusin event, so fire focusIn on
    // the trigger span (the [data-state] element) — the reliable open trigger.
    fireEvent.focusIn(screen.getByText("child").closest("[data-state]")!)

    // The label mounts and is portaled OUT of the overflow container to body.
    const labels = await screen.findAllByText("Mike Shea")
    const clip = screen.getByTestId("clip")
    const portaled = labels.find((el) => !clip.contains(el))
    expect(portaled).toBeDefined()
    expect(document.body.contains(portaled!)).toBe(true)
  })
})
