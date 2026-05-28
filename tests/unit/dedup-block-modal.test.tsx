/**
 * Push 3 (C4) — DedupBlockModal unit test.
 *
 * Verifies the modal renders matched contact info + the two buttons
 * (no override per memory #22). Click → callbacks fire.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DedupBlockModal } from "@/modules/contacts/ui/dedup-block-modal"

// dedup-types.ts is pure so it works directly in jsdom; no mock needed.

describe("DedupBlockModal", () => {
  it("renders matched contact label + subtext + the matched field in the message", () => {
    render(
      <DedupBlockModal
        open
        onClose={vi.fn()}
        matchedContactId="c-1"
        matchedContactLabel="Alice Smith"
        matchedContactSubtext="alice@example.com"
        matchedField="primaryEmail"
      />,
    )
    expect(screen.getByText("Alice Smith")).toBeInTheDocument()
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    expect(screen.getByText(/primary email/)).toBeInTheDocument()
  })

  it("'Go to existing contact' links to the matched contact's detail route", () => {
    render(
      <DedupBlockModal
        open
        onClose={vi.fn()}
        matchedContactId="abc123"
        matchedContactLabel="Bob"
        matchedField="primaryPhone"
      />,
    )
    const link = screen.getByTestId("dedup-modal-go-existing")
    expect(link).toHaveAttribute("href", "/contacts/abc123")
  })

  it("Cancel fires onClose", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <DedupBlockModal
        open
        onClose={onClose}
        matchedContactId="x"
        matchedContactLabel="X"
        matchedField="secondaryPhone"
      />,
    )
    await user.click(screen.getByTestId("dedup-modal-cancel"))
    expect(onClose).toHaveBeenCalled()
  })

  it("does NOT render an 'Override' or 'Create anyway' button (no override per memory #22)", () => {
    render(
      <DedupBlockModal
        open
        onClose={vi.fn()}
        matchedContactId="c-1"
        matchedContactLabel="Alice"
        matchedField="primaryEmail"
      />,
    )
    expect(screen.queryByText(/override/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/create anyway/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/force/i)).not.toBeInTheDocument()
  })
})
