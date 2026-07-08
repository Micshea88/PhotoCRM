/**
 * Unit tests for the ReconnectBanner component (Task 19).
 *
 * Covers:
 *   - Renders the email address + Reconnect link when ≥1 expired connection.
 *   - Renders the N-connection summary when >1 expired.
 *   - Dismiss (X) hides the banner via client useState.
 *   - Renders nothing when the expired list is empty.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Mock next/link so it renders as a plain <a> in jsdom.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [k: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { ReconnectBanner } from "@/modules/email-connections/ui/reconnect-banner"
import type { ExpiredConnectionSummary } from "@/modules/email-connections/ui/reconnect-banner"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConn(email: string, id = email): ExpiredConnectionSummary {
  return { id, email }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReconnectBanner", () => {
  it("renders nothing when the expired list is empty", () => {
    const { container } = render(<ReconnectBanner expiredConnections={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders the email address and a Reconnect link when 1 expired connection", () => {
    render(<ReconnectBanner expiredConnections={[makeConn("alice@example.com")]} />)

    // Heading text
    expect(screen.getByText("Your email connection needs attention")).toBeInTheDocument()

    // Body includes the email
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument()

    // Reconnect link points to /settings/integrations
    const link = screen.getByRole("link", { name: "Reconnect" })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute("href", "/settings/integrations")
  })

  it("renders the N-connection summary message when >1 expired connection", () => {
    render(
      <ReconnectBanner
        expiredConnections={[makeConn("alice@example.com"), makeConn("bob@example.com")]}
      />,
    )

    // Should summarize with a count, not list each email
    expect(screen.getByText(/2 email connections need reconnecting/)).toBeInTheDocument()

    // Reconnect link still present
    expect(screen.getByRole("link", { name: "Reconnect" })).toBeInTheDocument()
  })

  it("hides the banner when the dismiss button is clicked", async () => {
    const user = userEvent.setup()
    render(<ReconnectBanner expiredConnections={[makeConn("alice@example.com")]} />)

    // Banner is visible before dismiss
    expect(screen.getByRole("alert")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Dismiss reconnect banner" }))

    // Banner should be gone
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("dismiss button has the correct aria-label", () => {
    render(<ReconnectBanner expiredConnections={[makeConn("carol@example.com")]} />)
    const btn = screen.getByRole("button", { name: "Dismiss reconnect banner" })
    expect(btn).toBeInTheDocument()
  })

  it("banner has role=alert for accessibility", () => {
    render(<ReconnectBanner expiredConnections={[makeConn("dave@example.com")]} />)
    expect(screen.getByRole("alert")).toBeInTheDocument()
  })
})
