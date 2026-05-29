/**
 * Push 3 (C6c polish) — InlineEditField autosave contract.
 *
 * The C6c first-cut had ✓/✗ buttons; this polish push deletes them
 * entirely. New contract:
 *   - click → edit mode (thin underline)
 *   - blur OR Enter → autosave + exit
 *   - Esc → revert + exit
 *   - error → stay in edit mode + show inline message
 *   - phone variant (displayValue + editValue + normalizeOnSave +
 *     validateBeforeSave) feeds formatted display, accepts any input,
 *     saves digits-only, rejects non-10-digit US numbers inline.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { InlineEditField } from "@/components/ui/inline-edit-field"
import { formatPhoneDisplay, parsePhoneInput } from "@/lib/format/phone"

describe("InlineEditField — read mode", () => {
  it("renders the value", () => {
    render(<InlineEditField value="alice@example.com" onSave={vi.fn()} />)
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
  })

  it("renders the placeholder when value is null", () => {
    render(<InlineEditField value={null} onSave={vi.fn()} placeholder="(none)" />)
    expect(screen.getByText("(none)")).toBeInTheDocument()
  })

  it("renders displayValue instead of value when provided", () => {
    render(<InlineEditField value="5551234567" displayValue="(555) 123-4567" onSave={vi.fn()} />)
    expect(screen.getByText("(555) 123-4567")).toBeInTheDocument()
    expect(screen.queryByText("5551234567")).not.toBeInTheDocument()
  })

  it("does NOT enter edit mode when disabled", async () => {
    const user = userEvent.setup()
    render(<InlineEditField value="x" onSave={vi.fn()} disabled />)
    await user.click(screen.getByText("x"))
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })
})

describe("InlineEditField — autosave on Enter + blur", () => {
  it("Enter commits the new value", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve(undefined))
    render(<InlineEditField value="old" onSave={onSave} ariaLabel="Field" />)
    await user.click(screen.getByRole("button", { name: "Field" }))
    const input = screen.getByLabelText("Field")
    await user.clear(input)
    await user.type(input, "new")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSave).toHaveBeenCalledWith("new")
  })

  it("blur commits the new value (no buttons exist)", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve(undefined))
    render(
      <>
        <InlineEditField value="old" onSave={onSave} ariaLabel="Field" />
        <button>elsewhere</button>
      </>,
    )
    await user.click(screen.getByRole("button", { name: "Field" }))
    const input = screen.getByLabelText("Field")
    await user.clear(input)
    await user.type(input, "new")
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith("new")
  })

  it("no Save / Cancel buttons rendered in edit mode", async () => {
    const user = userEvent.setup()
    render(<InlineEditField value="x" onSave={vi.fn()} ariaLabel="F" />)
    await user.click(screen.getByRole("button", { name: "F" }))
    expect(screen.queryByLabelText("Save")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Cancel")).not.toBeInTheDocument()
  })

  it("no-op when value unchanged on blur", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<InlineEditField value="same" onSave={onSave} ariaLabel="F" />)
    await user.click(screen.getByText("same"))
    fireEvent.blur(screen.getByLabelText("F"))
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe("InlineEditField — Esc reverts", () => {
  it("Escape exits without calling onSave", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<InlineEditField value="x" onSave={onSave} ariaLabel="F" />)
    await user.click(screen.getByText("x"))
    const input = screen.getByLabelText("F")
    await user.clear(input)
    await user.type(input, "y")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText("x")).toBeInTheDocument()
  })
})

describe("InlineEditField — error path", () => {
  it("onSave { error } stays in edit mode + surfaces inline message", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve({ error: "Server says no." }))
    render(<InlineEditField value="x" onSave={onSave} ariaLabel="F" />)
    await user.click(screen.getByText("x"))
    const input = screen.getByLabelText("F")
    await user.clear(input)
    await user.type(input, "y")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(await screen.findByText("Server says no.")).toBeInTheDocument()
    expect(screen.getByLabelText("F")).toBeInTheDocument()
  })

  it("onSave throw stays in edit mode + surfaces message", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.reject(new Error("Boom.")))
    render(<InlineEditField value="x" onSave={onSave} ariaLabel="F" />)
    await user.click(screen.getByText("x"))
    const input = screen.getByLabelText("F")
    await user.clear(input)
    await user.type(input, "y")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(await screen.findByText("Boom.")).toBeInTheDocument()
  })
})

describe("InlineEditField — phone variant (display + normalize + validate)", () => {
  it("displays formatted phone; edit accepts any input; save normalizes to digits", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve(undefined))
    const value = "5551234567"
    render(
      <InlineEditField
        value={value}
        displayValue={formatPhoneDisplay(value)}
        editValue={formatPhoneDisplay(value)}
        onSave={onSave}
        normalizeOnSave={(raw) => parsePhoneInput(raw) ?? ""}
        validateBeforeSave={(n) =>
          n === "" || n.length === 10 ? null : "Enter a 10-digit US phone."
        }
        ariaLabel="Phone"
        type="tel"
      />,
    )
    // Read mode shows formatted.
    expect(screen.getByText("(555) 123-4567")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Phone" }))
    const input = screen.getByLabelText("Phone")
    await user.clear(input)
    // User types in a different format — parens / dashes / spaces all OK.
    await user.type(input, "(555) 987-6543")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSave).toHaveBeenCalledWith("5559876543")
  })

  it("rejects non-10-digit input inline + stays in edit mode", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve(undefined))
    render(
      <InlineEditField
        value="5551234567"
        displayValue="(555) 123-4567"
        editValue="(555) 123-4567"
        onSave={onSave}
        normalizeOnSave={(raw) => parsePhoneInput(raw) ?? "bad"}
        validateBeforeSave={(n) =>
          n === "" || n.length === 10 ? null : "Enter a 10-digit US phone."
        }
        ariaLabel="Phone"
        type="tel"
      />,
    )
    await user.click(screen.getByRole("button", { name: "Phone" }))
    const input = screen.getByLabelText("Phone")
    await user.clear(input)
    await user.type(input, "12345")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSave).not.toHaveBeenCalled()
    expect(await screen.findByText(/10-digit US phone/)).toBeInTheDocument()
  })
})
