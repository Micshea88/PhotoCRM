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
// The Create-an-email composer (client) imports files/email server actions
// that transitively reach @/lib/db; stub it (these tests don't exercise it).
vi.mock("@/modules/email-log/ui/create-email-composer", () => ({
  CreateEmailComposer: () => null,
}))
vi.mock("@/modules/email-log/actions", () => ({
  updateEmail: vi.fn(),
  deleteEmail: vi.fn(),
  logEmail: vi.fn(),
}))

// next/navigation: the activity-card uses useRouter().refresh() on
// edit-save. In jsdom there's no app router; stub it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

// Telephony 3a inline-dialer refactor — ContactActivityFeed and
// ActionIconRow read useDialer() from the dialer-context provider.
// That module imports the WebPhone SDK + server actions, neither of
// which loads cleanly in jsdom (WebPhone hits WebRTC APIs; actions
// chain into @/lib/db). Stub the context surface to a no-op API.
vi.mock("@/modules/telephony/ui/dialer-context", () => ({
  useDialer: () => ({
    state: { kind: "idle" },
    isReady: false,
    isAvailable: false,
    externalUserId: "",
    setAudioElement: vi.fn(),
    now: 0,
    widgetExpanded: false,
    expandWidget: vi.fn(),
    collapseWidget: vi.fn(),
    startCall: vi.fn(),
    hangup: vi.fn(),
    toggleMute: vi.fn(),
    sendDtmf: vi.fn(),
  }),
  DialerProvider: ({ children }: { children: React.ReactNode }) => children,
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
    // The reasoning surfaces via the badge's native title tooltip.
    expect(screen.getByText("Hot Lead").closest("[title]")).toHaveAttribute(
      "title",
      "Recent inbound.",
    )
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

  it("renders all entries + the 6-tab communications sub-filter strip (Tasks moved to its own tab)", () => {
    render(<ContactActivityFeed contactId="test-c" entries={entries} />)
    // Title format: "<Kind> by <Actor>" for non-call kinds (Polish #5
    // Fix 6 original contract). Calls are the exception — they preserve
    // the loader's structured title ("Call (outgoing) · M:SS") so the
    // direction + duration signal isn't lost. See the fix for the
    // 2026-06-10 "Call by Mike" regression on dialer-logged calls.
    expect(screen.getByText("Note by Alice")).toBeInTheDocument()
    expect(screen.getByText("Call (outgoing)")).toBeInTheDocument()
    // Contact Tasks build — the strip is communications-only (6 tabs);
    // Tasks is now a top-level contact tab, not a sub-filter here.
    expect(screen.getByRole("tab", { name: /All activities \(2\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Notes \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Calls \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Emails \(0\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Meetings \(0\)/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /SMS \(0\)/ })).toBeInTheDocument()
    // Tasks is no longer a sub-filter tab.
    expect(screen.queryByRole("tab", { name: /Tasks \(/ })).toBeNull()
  })

  it("filter tab narrows the visible entries", async () => {
    const user = userEvent.setup()
    render(<ContactActivityFeed contactId="test-c" entries={entries} />)
    await user.click(screen.getByRole("tab", { name: /Calls \(1\)/ }))
    expect(screen.queryByText("Note by Alice")).not.toBeInTheDocument()
    expect(screen.getByText("Call (outgoing)")).toBeInTheDocument()
  })

  it("empty state prompts the user to use Add Note / Log Call", () => {
    render(<ContactActivityFeed contactId="test-c" entries={[]} />)
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument()
  })

  it("Item 1a — pencil-edit shows underlined textarea with NO Save/Cancel buttons", async () => {
    const user = userEvent.setup()
    const entriesWithRawId: ActivityEntry[] = [
      {
        id: "n1",
        rawId: "raw-n1",
        kind: "note",
        timestamp: new Date(Date.now() - 60_000),
        title: "Note added",
        body: "Original body",
        actor: "Alice",
      },
    ]
    render(<ContactActivityFeed contactId="test-c" entries={entriesWithRawId} />)
    await user.click(screen.getByTestId("activity-edit-note"))
    // Edit mode: textarea appears, autofocused.
    const textarea = screen.getByTestId("activity-edit-body-note")
    expect(textarea).toBeInTheDocument()
    // §1 pencil-only — NO Save / Cancel buttons inside the edit area.
    expect(screen.queryByRole("button", { name: /^Save$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Cancel$/ })).not.toBeInTheDocument()
  })

  it("Item 1c — All-tab Type chips filter in place (do NOT change the active tab)", async () => {
    const user = userEvent.setup()
    render(<ContactActivityFeed contactId="test-c" entries={entries} />)
    // All-activities tab is the default; click the Calls chip.
    await user.click(screen.getByRole("button", { name: /Calls/ }))
    // Active tab is still All activities.
    expect(screen.getByRole("tab", { name: /All activities \(2\)/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    // Note hidden by the in-place type filter.
    expect(screen.queryByText("Note by Alice")).not.toBeInTheDocument()
    expect(screen.getByText("Call (outgoing)")).toBeInTheDocument()
  })

  it("P-email-log — All-activities Type chip row includes Emails and filters in place", async () => {
    const user = userEvent.setup()
    const mixed: ActivityEntry[] = [
      ...entries,
      {
        id: "e2",
        rawId: "raw-e2",
        kind: "email",
        timestamp: new Date(Date.now() - 1000 * 60 * 2),
        title: "Email",
        subject: "Pricing follow-up",
        body: "Sent the proposal — let me know.",
        actor: "Alice",
      },
    ]
    render(<ContactActivityFeed contactId="test-c" entries={mixed} />)
    // The chip row lives under "Type:" on the All-activities tab.
    // Bug fix audit: the chip row should include Notes / Calls /
    // Emails / Meetings / SMS (matching the sub-tab order), not omit
    // Emails. Each chip is a <button>; the matching sub-tabs are
    // <tab> role. Scope to button role so we don't grab the sub-tab.
    expect(screen.getByRole("button", { name: "Notes" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Calls" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Emails" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Meetings" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "SMS" })).toBeInTheDocument()
    // Click the Emails chip — All-activities tab stays active; only
    // email entries render.
    await user.click(screen.getByRole("button", { name: "Emails" }))
    expect(screen.getByRole("tab", { name: /All activities \(3\)/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByText("Pricing follow-up")).toBeInTheDocument()
    expect(screen.queryByText("Note by Alice")).not.toBeInTheDocument()
    expect(screen.queryByText("Call (outgoing)")).not.toBeInTheDocument()
  })

  it("P-email-log — logged email surfaces under the Emails sub-tab with the mockup header + subject + body", async () => {
    const user = userEvent.setup()
    const withEmail: ActivityEntry[] = [
      ...entries,
      {
        id: "e1",
        rawId: "raw-e1",
        kind: "email",
        timestamp: new Date(Date.now() - 1000 * 60 * 5),
        title: "Email",
        subject: "Quick question about your August wedding",
        body: "Hey Ada,\n\nLoved chatting today — sending the pricing sheet through.",
        actor: "Alice",
      },
    ]
    render(<ContactActivityFeed contactId="test-c" entries={withEmail} />)
    // Emails sub-tab shows the count (1) — proves counts.email wires.
    const emailTab = screen.getByRole("tab", { name: /Emails \(1\)/ })
    expect(emailTab).toBeInTheDocument()
    await user.click(emailTab)
    // Header uses the "Email · {person}" pattern per the approved mockup.
    expect(screen.getByText(/Email · Alice/)).toBeInTheDocument()
    // Subject is the bold primary line.
    const subject = screen.getByTestId("activity-entry-email-subject")
    expect(subject).toBeInTheDocument()
    expect(subject).toHaveTextContent("Quick question about your August wedding")
    // Body still renders beneath the subject.
    expect(screen.getByText(/Loved chatting today/)).toBeInTheDocument()
    // Calls / notes are hidden on the Emails tab.
    expect(screen.queryByText("Note by Alice")).not.toBeInTheDocument()
    expect(screen.queryByText("Call (outgoing)")).not.toBeInTheDocument()
  })

  it("P-email-log — Notes / Calls keep body-only rendering (no subject line leaked onto them)", () => {
    render(<ContactActivityFeed contactId="test-c" entries={entries} />)
    // Notes + calls do NOT get an activity-entry-*-subject node.
    expect(screen.queryByTestId("activity-entry-note-subject")).not.toBeInTheDocument()
    expect(screen.queryByTestId("activity-entry-call-subject")).not.toBeInTheDocument()
  })
})

describe("ContactDetailCenter — tab strip", () => {
  // Contact Tasks build — center column now has 3 tabs:
  // Overview / Activity / Tasks. To-Do's removed; Tasks is its own
  // top-level tab (was the Activity sub-filter placeholder). FIX 1
  // (2026-06-19) renamed "Activities" → "Activity" (singular).
  it("renders Overview / Activity / Tasks and starts on Overview", async () => {
    const { ContactDetailCenter } = await import("@/modules/contacts/ui/contact-detail-center")
    render(
      <ContactDetailCenter
        overview={<div>OV</div>}
        activity={<div>AC</div>}
        tasks={<div>TK</div>}
      />,
    )
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute("aria-selected", "false")
    expect(screen.queryByRole("tab", { name: "To-Do's" })).toBeNull()
    expect(screen.getByText("OV")).toBeInTheDocument()
  })

  it("clicking a tab switches active state + content", async () => {
    const { ContactDetailCenter } = await import("@/modules/contacts/ui/contact-detail-center")
    const user = userEvent.setup()
    render(
      <ContactDetailCenter
        overview={<div>OV</div>}
        activity={<div>AC</div>}
        tasks={<div>TK</div>}
      />,
    )
    await user.click(screen.getByRole("tab", { name: "Activity" }))
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("AC")).toBeInTheDocument()
    expect(screen.queryByText("OV")).not.toBeInTheDocument()
  })

  it("honors initialTab from the URL (FIX 1 — survives router.refresh)", async () => {
    const { ContactDetailCenter } = await import("@/modules/contacts/ui/contact-detail-center")
    render(
      <ContactDetailCenter
        initialTab="tasks"
        overview={<div>OV</div>}
        activity={<div>AC</div>}
        tasks={<div>TK</div>}
      />,
    )
    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("TK")).toBeInTheDocument()
  })
})
