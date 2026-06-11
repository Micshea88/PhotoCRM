/**
 * Unit tests for `DispositionBadge` — the color-coded pill rendered
 * next to the activity-card title for call entries.
 *
 * Contract:
 *   - Renders the display label (e.g., "Connected", "No Answer") for
 *     each known disposition value.
 *   - Renders nothing when disposition is null / undefined / unknown
 *     (graceful degradation for pre-2026-06-11 manual rows that lack
 *     a disposition column value).
 *   - Applies a kind-specific color class per the design system.
 *
 * Same mock surface as ai-cards.test.tsx — the import chain from
 * contact-activity-feed pulls in dialer-context + server actions
 * which transitively reach @/lib/db.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

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
    canTransfer: false,
    transferNeedsReconnect: false,
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
    transferToMobile: vi.fn(),
  }),
  DialerProvider: ({ children }: { children: React.ReactNode }) => children,
}))

import { DispositionBadge } from "@/modules/contacts/ui/contact-activity-feed"

describe("DispositionBadge", () => {
  describe("known dispositions render with display label + testid", () => {
    it.each([
      ["completed", "Connected"],
      ["no_answer", "No Answer"],
      ["busy", "Busy"],
      ["failed", "Failed"],
      ["cancelled", "Cancelled"],
      ["transferred", "Transferred"],
      ["voicemail", "Left Voicemail"],
      ["wrong_number", "Wrong Number"],
    ])("disposition=%s renders label %s", (disposition, label) => {
      render(<DispositionBadge disposition={disposition} />)
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByTestId(`disposition-badge-${disposition}`)).toBeInTheDocument()
    })
  })

  describe("graceful degradation", () => {
    it("renders nothing when disposition is null", () => {
      const { container } = render(<DispositionBadge disposition={null} />)
      expect(container.firstChild).toBeNull()
    })

    it("renders nothing when disposition is undefined", () => {
      const { container } = render(<DispositionBadge disposition={undefined} />)
      expect(container.firstChild).toBeNull()
    })

    it("renders nothing for an unknown disposition value (graceful degradation)", () => {
      const { container } = render(<DispositionBadge disposition="legacy_outcome" />)
      expect(container.firstChild).toBeNull()
    })

    it("renders nothing for an empty string disposition", () => {
      const { container } = render(<DispositionBadge disposition="" />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe("color-class application", () => {
    it("applies the emerald palette for completed (Connected)", () => {
      render(<DispositionBadge disposition="completed" />)
      const badge = screen.getByTestId("disposition-badge-completed")
      expect(badge.className).toMatch(/emerald/)
    })

    it("applies the red palette for busy", () => {
      render(<DispositionBadge disposition="busy" />)
      const badge = screen.getByTestId("disposition-badge-busy")
      expect(badge.className).toMatch(/red/)
    })

    it("applies the amber palette for no_answer", () => {
      render(<DispositionBadge disposition="no_answer" />)
      const badge = screen.getByTestId("disposition-badge-no_answer")
      expect(badge.className).toMatch(/amber/)
    })

    it("applies the blue palette for transferred", () => {
      render(<DispositionBadge disposition="transferred" />)
      const badge = screen.getByTestId("disposition-badge-transferred")
      expect(badge.className).toMatch(/blue/)
    })

    it("applies the gray palette for cancelled", () => {
      render(<DispositionBadge disposition="cancelled" />)
      const badge = screen.getByTestId("disposition-badge-cancelled")
      expect(badge.className).toMatch(/gray/)
    })
  })
})
