/**
 * Unit tests for `entryTitleText` (contact-activity-feed.tsx).
 *
 * Regression guard for the bug Mike hit 2026-06-10: the function used
 * to override the loader's structured call title (e.g.
 * `"Call (outgoing) · 0:42"`) with the generic `"Call by Mike"` whenever
 * `actor` was set. Every dialer-logged call always carries `actor` (the
 * action writes `userId`), so the loader's direction + duration signal
 * was silently dropped.
 *
 * Contract under test:
 *   - For `kind === "call"`, return the loader's `title` verbatim
 *     (fallback to "Call" if title is empty). Actor is ignored.
 *   - For other kinds with `actor` set, render as `"<Kind> by <Actor>"`
 *     (or `"Email · <Actor>"` for the email mockup).
 *   - For any kind with no `actor`, fall back to `title || kindLabel`.
 */
import { describe, it, expect, vi } from "vitest"

// Importing from contact-activity-feed pulls in:
//   - dialer-context → recordOutboundCall
//   - per-kind update/delete server actions on contact-notes /
//     calls / meetings / sms / emails
// All of which transitively reach @/lib/db (server-only). Mock the
// boundaries so the import chain doesn't try to read server env vars
// in the unit (jsdom) environment. Mirrors the mock set in
// tests/unit/ai-cards.test.tsx; the two test files share the same
// import chain.
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
vi.mock("@/modules/email-log/actions", () => ({
  updateEmail: vi.fn(),
  deleteEmail: vi.fn(),
  logEmail: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
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

import { entryTitleText, type ActivityEntry } from "@/modules/contacts/ui/contact-activity-feed"

function makeEntry(overrides: Partial<ActivityEntry> & Pick<ActivityEntry, "kind">): ActivityEntry {
  return {
    id: "entry-id",
    rawId: "raw-id",
    timestamp: new Date("2026-06-10T12:00:00Z"),
    title: "",
    body: null,
    actor: null,
    ...overrides,
  }
}

describe("entryTitleText", () => {
  describe("call entries (the regression target)", () => {
    it("preserves the loader's structured title even when actor is set", () => {
      const entry = makeEntry({
        kind: "call",
        title: "Call (outgoing) · 0:42",
        actor: "Mike",
      })
      expect(entryTitleText(entry)).toBe("Call (outgoing) · 0:42")
    })

    it("preserves the loader's structured title for transferred calls", () => {
      const entry = makeEntry({
        kind: "call",
        title: "Call (outgoing) · 1:13",
        body: "Transferred to phone.",
        actor: "Mike",
      })
      expect(entryTitleText(entry)).toBe("Call (outgoing) · 1:13")
    })

    it("falls back to kindLabel when title is empty (defensive)", () => {
      const entry = makeEntry({
        kind: "call",
        title: "",
        actor: "Mike",
      })
      expect(entryTitleText(entry)).toBe("Call")
    })
  })

  describe("non-call entries (existing behavior preserved)", () => {
    it("renders notes as 'Note by Actor' when actor is set", () => {
      const entry = makeEntry({
        kind: "note",
        title: "Note added",
        actor: "Mike",
      })
      expect(entryTitleText(entry)).toBe("Note by Mike")
    })

    it("renders meetings as 'Meeting by Actor' when actor is set", () => {
      const entry = makeEntry({
        kind: "meeting",
        title: "Meeting — Discovery",
        actor: "Mike",
      })
      expect(entryTitleText(entry)).toBe("Meeting by Mike")
    })

    it("renders sms as 'SMS by Actor' when actor is set", () => {
      const entry = makeEntry({
        kind: "sms",
        title: "SMS (outbound)",
        actor: "Mike",
      })
      expect(entryTitleText(entry)).toBe("SMS by Mike")
    })

    it("renders email with the ' · ' separator (per P-email-log mockup)", () => {
      const entry = makeEntry({
        kind: "email",
        title: "Email",
        actor: "Mike",
      })
      expect(entryTitleText(entry)).toBe("Email · Mike")
    })

    it("falls back to title when actor is null (any non-call kind)", () => {
      const entry = makeEntry({
        kind: "note",
        title: "Note added",
        actor: null,
      })
      expect(entryTitleText(entry)).toBe("Note added")
    })

    it("falls back to kindLabel when both title and actor are empty/null", () => {
      const entry = makeEntry({
        kind: "meeting",
        title: "",
        actor: null,
      })
      expect(entryTitleText(entry)).toBe("Meeting")
    })
  })
})
