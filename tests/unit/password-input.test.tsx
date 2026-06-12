/**
 * Unit test for PasswordInput — the platform-wide show/hide toggle.
 *
 * Contract: starts hidden (type="password"); clicking the toggle flips the
 * input type to "text" and the button's aria-label to "Hide password", and
 * back. The toggle is type="button" so it never submits the form.
 */
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PasswordInput } from "@/components/ui/password-input"

describe("PasswordInput", () => {
  it("flips input type and aria-label between hidden and visible", () => {
    const { container } = render(<PasswordInput defaultValue="secret" />)
    const input = container.querySelector("input")
    if (!input) throw new Error("input not rendered")

    // Hidden by default.
    expect(input.type).toBe("password")
    const show = screen.getByRole("button", { name: "Show password" })

    // Reveal.
    fireEvent.click(show)
    expect(input.type).toBe("text")
    const hide = screen.getByRole("button", { name: "Hide password" })
    expect(hide).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Show password" })).not.toBeInTheDocument()

    // Hide again.
    fireEvent.click(hide)
    expect(input.type).toBe("password")
    expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument()
  })

  it("the toggle is a non-submitting button", () => {
    render(<PasswordInput />)
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("type", "button")
  })

  it("forwards the ref to the underlying input (react-hook-form compatibility)", () => {
    let node: HTMLInputElement | null = null
    render(
      <PasswordInput
        ref={(n) => {
          node = n
        }}
      />,
    )
    expect(node).toBeInstanceOf(HTMLInputElement)
  })
})
