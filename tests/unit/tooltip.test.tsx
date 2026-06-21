/**
 * Tests for the CSS-only Tooltip primitive: it renders the wrapped child and
 * exposes the label via role="tooltip" (always in the DOM; CSS controls
 * hover/focus visibility). Replaces the slow/unreliable native `title`.
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Tooltip } from "@/components/ui/tooltip"

describe("Tooltip", () => {
  it("renders the wrapped child and the label as a tooltip", () => {
    render(
      <Tooltip label="Mike Shea">
        <button type="button">child</button>
      </Tooltip>,
    )
    expect(screen.getByText("child")).toBeInTheDocument()
    expect(screen.getByRole("tooltip")).toHaveTextContent("Mike Shea")
  })
})
