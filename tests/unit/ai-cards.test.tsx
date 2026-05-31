/**
 * Push 3 (C6c) — AI card components (badge / summary / insights) +
 * the activity feed primitive. All pure UI; no AI calls, no server
 * actions.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// P-activities — ContactActivityFeed now imports server actions
// (update/delete on notes/calls/meetings/sms + the inline composers'
// create paths) that transitively pull in @/lib/db. Stub the action
// surface so jsdom doesn't try to evaluate the server-only env.
vi.mock("@/modules/contacts/actions", () => ({
  updateContactNote: vi.fn(),
  deleteContactNote: vi.fn(),
  createContactNote: vi.fn(),
}))
vi.mock("@/modules/calls/actions", () => ({
  updateCall: vi.fn(),
  deleteCall: vi.fn(),
  logCall: vi.fn(),
}))
vi.mock("@/modules/meetings/actions", () => ({
  updateMeeting: vi.fn(),
  deleteMeeting: vi.fn(),
  logMeeting: vi.fn(),
}))
vi.mock("@/modules/sms-messages/actions", () => ({
  updateSms: vi.fn(),
  deleteSms: vi.fn(),
  logSms: vi.fn(),
}))

// next/navigation: the activity-card uses useRouter().refresh() on
// edit-save. In jsdom there's no app router; stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import { AiStatusBadge } from "@/modules/contacts/ui/ai-status-badge"
import { AiSummaryCard } from "@/modules/contacts/ui/ai-summary-card"
import { AiInsightsCard } from "@/modules/contacts/ui/ai-insights-card"
import {
  ContactActivityFeed,
  type ActivityEntry,
} from "@/modules/contacts/ui/contact-activity-feed"
import type { AiInsight } from "@/modules/contacts/ai/insights-detector"

describe("AiStatusBadge", () => {
  it("renders the status text", () => {
    render(<AiStatusBadge status="Hot Lead" reasoning="Recent inbound." />)
    expect(screen.getByText("Hot Lead")).toBeInTheDocument()
    expect(screen.getByTestId("ai-status-badge")).toHaveAttribute("title", "Recent inbound.")
  })

  it('renders "No classification yet" when status is null', () => {
    render(<AiStatusBadge status={null} reasoning={null} />)
    expect(screen.getByText("No classification yet")).toBeInTheDocument()
  })

  it("accepts free-form status outside the 19-enum (falls back to neutral palette)", () => {
    render(<AiStatusBadge status="Premium engaged hot lead" reasoning={null} />)
    expect(screen.getByText("Premium engaged hot lead")).toBeInTheDocument()
  })
})

describe("AiSummaryCard", () => {
  it("renders the summary + generation footer", () => {
    render(
      <AiSummaryCard
        summary="Ada is a hot lead inquiring about an August wedding."
        generatedAt={new Date(Date.now() - 1000 * 60 * 5)}
        generationModel="claude-haiku-4-5-20251001"
      />,
    )
    expect(screen.getByText(/Ada is a hot lead/)).toBeInTheDocument()
    expect(screen.getByText(/via claude-haiku-4-5-20251001/)).toBeInTheDocument()
  })

  it("empty state when summary is null", () => {
    render(<AiSummaryCard summary={null} generatedAt={null} generationModel={null} />)
    expect(screen.getByText(/No summary cached yet/)).toBeInTheDocument()
  })

  it("renders the rightSlot (e.g. Regenerate button)", () => {
    render(
      <AiSummaryCard
        summary="ok"
        generatedAt={null}
        generationModel={null}
        rightSlot={<button>Regenerate</button>}
      />,
    )
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument()
  })
})

describe("AiInsightsCard", () => {
  function insight(kind: AiInsight["kind"]): AiInsight {
    return {
      kind,
      title: `Title-${kind}`,
      text: `Text for ${kind}`,
      actions: [
        { kind: "navigate", label: "Open", payload: `/contacts?x=${kind}` },
        { kind: "compose_email", label: "Email", payload: `payload-${kind}` },
      ],
    }
  }

  it("renders nothing when insights is empty", () => {
    const { container } = render(<AiInsightsCard insights={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders a card per insight + navigate action as a Link", () => {
    render(<AiInsightsCard insights={[insight("cold_reengage")]} />)
    expect(screen.getByText("Title-cold_reengage")).toBeInTheDocument()
    expect(screen.getByText("Text for cold_reengage")).toBeInTheDocument()
    // The "Open" action is a navigate; with asChild it renders an
    // <a> via Next.js Link. We just check it exists by role.
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/contacts?x=cold_reengage",
    )
  })
})

describe("ContactActivityFeed", () => {
  const entries: ActivityEntry[] = [
    {
      id: "n1",
      kind: "note",
      timestamp: new Date(Date.now() - 1000 * 60),
      title: "Note added",
      body: "Hello there",
      actor: "Alice",
    },
    {
      id: "c1",
      kind: "call",
      timestamp: new Date(Date.now() - 1000 * 60 * 30),
      title: "Call (outgoing)",
      body: "Outcome: Connected\nQuick chat",
      actor: "Bob",
    },
  ]

  it("renders all entries + the locked 7-tab sub-filter strip", () => {
    render(<ContactActivityFeed contactId="test-c" entries={entries} />)
    // Polish #5 Fix 6 — title format is "{Type} by {Author}".
    expect(screen.getByText("Note by Alice")).toBeInTheDocument()
    expect(screen.getByText("Call by Bob")).toBeInTheDocument()
    // Polish #5 Fix 7b — sub-tab strip with 7 fixed tabs, counts inline.
    expect(screen.getByRole("tab", { name: /All activities \(2\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Notes \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Calls \(1\)/ })).toBeInTheDocument()
    // Placeholder filters surface with zero counts but always present.
    expect(screen.getByRole("tab", { name: /Emails \(0\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Tasks \(0\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Meetings \(0\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /SMS \(0\)/ })).toBeInTheDocument()
  })

  it("filter tab narrows the visible entries", async () => {
    const user = userEvent.setup()
    render(<ContactActivityFeed contactId="test-c" entries={entries} />)
    await user.click(screen.getByRole("tab", { name: /Calls \(1\)/ }))
    expect(screen.queryByText("Note by Alice")).not.toBeInTheDocument()
    expect(screen.getByText("Call by Bob")).toBeInTheDocument()
  })

  it("empty state prompts the user to use Add Note / Log Call", () => {
    render(<ContactActivityFeed contactId="test-c" entries={[]} />)
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument()
  })
})

describe("ContactDetailCenter — tab strip", () => {
  // Polish #5 Fix 7a — center column now has 2 tabs only:
  // Overview / Activities. To-Do's removed; Tasks moved to the
  // Activities sub-filter strip (Push 7 wires it).
  it("renders Overview / Activities and starts on Overview", async () => {
    const { ContactDetailCenter } = await import("@/modules/contacts/ui/contact-detail-center")
    render(<ContactDetailCenter overview={<div>OV</div>} activity={<div>AC</div>} />)
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Activities" })).toHaveAttribute(
      "aria-selected",
      "false",
    )
    expect(screen.queryByRole("tab", { name: "To-Do's" })).toBeNull()
    expect(screen.getByText("OV")).toBeInTheDocument()
  })

  it("clicking a tab switches active state + content", async () => {
    const { ContactDetailCenter } = await import("@/modules/contacts/ui/contact-detail-center")
    const user = userEvent.setup()
    render(<ContactDetailCenter overview={<div>OV</div>} activity={<div>AC</div>} />)
    await user.click(screen.getByRole("tab", { name: "Activities" }))
    expect(screen.getByRole("tab", { name: "Activities" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("AC")).toBeInTheDocument()
    expect(screen.queryByText("OV")).not.toBeInTheDocument()
  })
})
