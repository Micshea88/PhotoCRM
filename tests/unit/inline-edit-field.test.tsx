/**
 * Push 3 (C6c) — InlineEditField primitive tests.
 *
 * Verifies the contract surfaced to consumers (contact detail page):
 * click enters edit mode, save commits, cancel reverts, errors surface
 * inline + keep the field in edit mode, Enter saves, Escape cancels.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { InlineEditField } from "@/components/ui/inline-edit-field"

describe("InlineEditField — read mode", () => {
  it("shows the value", () => {
    render(<InlineEditField value="alice@example.com" onSave={vi.fn()} />)
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
  })

  it("shows placeholder when value is null", () => {
    render(<InlineEditField value={null} onSave={vi.fn()} placeholder="(empty)" />)
    expect(screen.getByText("(empty)")).toBeInTheDocument()
  })

  it("does not enter edit mode when disabled", async () => {
    const user = userEvent.setup()
    render(<InlineEditField value="x" onSave={vi.fn()} disabled />)
    await user.click(screen.getByText("x"))
    // No save/cancel buttons rendered
    expect(screen.queryByLabelText("Save")).not.toBeInTheDocument()
  })
})

describe("InlineEditField — edit mode", () => {
  it("click enters edit mode", async () => {
    const user = userEvent.setup()
    render(<InlineEditField value="x" onSave={vi.fn()} ariaLabel="Field" />)
    await user.click(screen.getByText("x"))
    expect(screen.getByLabelText("Field")).toBeInTheDocument()
    expect(screen.getByLabelText("Save")).toBeInTheDocument()
    expect(screen.getByLabelText("Cancel")).toBeInTheDocument()
  })

  it("save commits the new value via onSave", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve(undefined))
    render(<InlineEditField value="old" onSave={onSave} ariaLabel="Field" />)
    await user.click(screen.getByText("old"))
    const input = screen.getByLabelText("Field")
    await user.clear(input)
    await user.type(input, "new")
    await user.click(screen.getByLabelText("Save"))
    expect(onSave).toHaveBeenCalledWith("new")
  })

  it("Enter key commits", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve(undefined))
    render(<InlineEditField value="" onSave={onSave} placeholder="(empty)" ariaLabel="Field" />)
    // Read-mode button uses ariaLabel="Field" (passed through).
    await user.click(screen.getByRole("button", { name: "Field" }))
    const input = screen.getByLabelText("Field")
    await user.type(input, "typed")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSave).toHaveBeenCalledWith("typed")
  })

  it("Escape cancels without calling onSave", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<InlineEditField value="x" onSave={onSave} ariaLabel="Field" />)
    await user.click(screen.getByText("x"))
    const input = screen.getByLabelText("Field")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(onSave).not.toHaveBeenCalled()
    // Back to read mode
    expect(screen.getByText("x")).toBeInTheDocument()
  })

  it("no-op when value unchanged", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<InlineEditField value="same" onSave={onSave} ariaLabel="Field" />)
    await user.click(screen.getByText("same"))
    await user.click(screen.getByLabelText("Save"))
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe("InlineEditField — error path", () => {
  it("inline error message + stays in edit mode when onSave returns { error }", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve({ error: "Server says no." }))
    render(<InlineEditField value="x" onSave={onSave} ariaLabel="Field" />)
    await user.click(screen.getByText("x"))
    const input = screen.getByLabelText("Field")
    await user.clear(input)
    await user.type(input, "y")
    await user.click(screen.getByLabelText("Save"))
    // Error surfaces
    expect(await screen.findByText("Server says no.")).toBeInTheDocument()
    // Still in edit mode (input still rendered)
    expect(screen.getByLabelText("Field")).toBeInTheDocument()
  })

  it("error message surfaces when onSave throws", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.reject(new Error("Boom.")))
    render(<InlineEditField value="x" onSave={onSave} ariaLabel="Field" />)
    await user.click(screen.getByText("x"))
    const input = screen.getByLabelText("Field")
    await user.clear(input)
    await user.type(input, "y")
    await user.click(screen.getByLabelText("Save"))
    expect(await screen.findByText("Boom.")).toBeInTheDocument()
  })
})
