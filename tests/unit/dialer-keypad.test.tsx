/**
 * Unit tests for the idle DialPad + keypad press-flash.
 *
 * DialPad contract:
 *   - Keypad presses AND typing append to the number field.
 *   - Pasted/typed formatting is stripped to dialable chars (digits + * #).
 *   - Call submits the entered number through the provided onCall handler
 *     (which the parent wires to dialer.startCall); disabled while empty.
 *
 * Keypad flash contract (the fix for "no visible highlight"):
 *   - onPointerDown applies the accent highlight immediately (visible even
 *     on a fast click), and it clears ~140ms later.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, fireEvent } from "@testing-library/react"
import { DialPad } from "@/modules/telephony/ui/dialer-controls"

describe("DialPad — idle dialer", () => {
  it("appends keypad presses to the number field", () => {
    render(<DialPad onCall={vi.fn()} />)
    const input = screen.getByLabelText("Phone number")
    fireEvent.click(screen.getByRole("button", { name: "7" }))
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    fireEvent.click(screen.getByRole("button", { name: "*" }))
    fireEvent.click(screen.getByRole("button", { name: "#" }))
    expect(input).toHaveValue("72*#")
  })

  it("strips formatting on typing/paste (keeps digits + * #)", () => {
    render(<DialPad onCall={vi.fn()} />)
    const input = screen.getByLabelText("Phone number")
    fireEvent.change(input, { target: { value: "+1 (727) 555-1234" } })
    expect(input).toHaveValue("17275551234")
  })

  it("Call submits the entered number and is disabled while empty", () => {
    const onCall = vi.fn()
    render(<DialPad onCall={onCall} />)
    const call = screen.getByRole("button", { name: "Call" })
    expect(call).toBeDisabled()

    const input = screen.getByLabelText("Phone number")
    fireEvent.change(input, { target: { value: "(727) 555-1234" } })
    expect(call).not.toBeDisabled()
    fireEvent.click(call)
    expect(onCall).toHaveBeenCalledWith("7275551234")
  })

  it("Enter in the field submits", () => {
    const onCall = vi.fn()
    render(<DialPad onCall={onCall} />)
    const input = screen.getByLabelText("Phone number")
    fireEvent.change(input, { target: { value: "7275551234" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onCall).toHaveBeenCalledWith("7275551234")
  })
})

describe("Keypad key — press flash", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("flashes the accent highlight on pointer-down and clears it ~140ms later", () => {
    render(<DialPad onCall={vi.fn()} />)
    const key = screen.getByRole("button", { name: "5" })

    expect(key.className).not.toContain("bg-[var(--color-accent)]")
    act(() => {
      fireEvent.pointerDown(key)
    })
    // Highlighted immediately — visible even for a fast click.
    expect(key.className).toContain("bg-[var(--color-accent)]")

    act(() => {
      vi.advanceTimersByTime(140)
    })
    expect(key.className).not.toContain("bg-[var(--color-accent)]")
  })
})
