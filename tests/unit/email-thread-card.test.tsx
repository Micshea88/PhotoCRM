/**
 * Unit tests for EmailThreadList / EmailThreadCard (Commit 3, Phase C).
 *
 * The component is pure — it imports only `groupEmailsByThread` + presentational
 * deps, so no module mocking is needed (unlike the feed-derived component tests
 * that transitively reach @/lib/db).
 *
 * Contract:
 *   - A singleton email (no replies) renders flat, with no "Thread (N)" pill and
 *     no expander.
 *   - A multi-message thread renders a "Thread (N replies)" pill and, collapsed,
 *     previews only the most recent message; expanding reveals all messages.
 */
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { EmailThreadList, type EmailThreadEntry } from "@/modules/email-log/ui/email-thread-card"

function entry(
  over: Partial<EmailThreadEntry> & { id: string; timestamp: Date },
): EmailThreadEntry {
  return { subject: "Subject", body: "Body", direction: "inbound", ...over }
}

describe("EmailThreadList", () => {
  it("renders a singleton email flat (no thread pill)", () => {
    render(
      <EmailThreadList
        emails={[entry({ id: "a", timestamp: new Date("2026-06-20T10:00:00Z"), subject: "Hello" })]}
      />,
    )
    expect(screen.getByText("Hello")).toBeInTheDocument()
    expect(screen.queryByText(/Thread \(/)).not.toBeInTheDocument()
  })

  it("groups a thread, shows the reply count, and expands to all messages", () => {
    const emails: EmailThreadEntry[] = [
      entry({
        id: "root",
        threadId: "t1",
        timestamp: new Date("2026-06-20T10:00:00Z"),
        subject: "Proposal",
        body: "First message",
        direction: "outbound",
      }),
      entry({
        id: "reply1",
        threadId: "t1",
        timestamp: new Date("2026-06-21T10:00:00Z"),
        subject: "Re: Proposal",
        body: "Second message",
      }),
      entry({
        id: "reply2",
        threadId: "t1",
        timestamp: new Date("2026-06-22T10:00:00Z"),
        subject: "Re: Proposal",
        body: "Third message",
      }),
    ]
    render(<EmailThreadList emails={emails} />)

    // 3 messages → 2 replies. Root subject drives the header.
    expect(screen.getByText("Thread (2 replies)")).toBeInTheDocument()
    expect(screen.getByText("Proposal")).toBeInTheDocument()

    // Collapsed: only the latest message previews.
    expect(screen.getByText("Third message")).toBeInTheDocument()
    expect(screen.queryByText("First message")).not.toBeInTheDocument()

    // Expand → all three messages visible.
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("First message")).toBeInTheDocument()
    expect(screen.getByText("Second message")).toBeInTheDocument()
    expect(screen.getByText("Third message")).toBeInTheDocument()
  })

  it("singular 'reply' for a two-message thread", () => {
    render(
      <EmailThreadList
        emails={[
          entry({ id: "r", threadId: "t2", timestamp: new Date("2026-06-20T10:00:00Z") }),
          entry({ id: "x", threadId: "t2", timestamp: new Date("2026-06-21T10:00:00Z") }),
        ]}
      />,
    )
    expect(screen.getByText("Thread (1 reply)")).toBeInTheDocument()
  })
})
