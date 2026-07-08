/**
 * Unit tests for the Task 18 additions to contact-activity-feed:
 *   - DeliveryStatusChip — outbound email delivery status chip
 *   - OpensPopout — "ⓘ Opens: N" with human/bot/unknown split + honesty copy
 *
 * Contract:
 *   - OUTBOUND email with deliveryStatus "bounced" renders "Bounced" chip;
 *     bounceReason appears in the title attribute when present.
 *   - Each delivery status maps to the correct chip label.
 *   - INBOUND email entries: no delivery chip rendered, no opens affordance.
 *   - Opens popout: given human/bot/unknown counts the expanded content shows
 *     the three-way split and the required honesty copy.
 *   - openCount === 0 (or absent) shows no opens affordance.
 *
 * The import chain from contact-activity-feed reaches server actions + dialer
 * context + @/lib/db; mock those boundaries exactly as the sibling tests do.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

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
vi.mock("@/modules/email-log/ui/create-email-composer", () => ({
  CreateEmailComposer: () => null,
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

import {
  DeliveryStatusChip,
  OpensPopout,
  ActivityCard,
  type ActivityEntry,
} from "@/modules/contacts/ui/contact-activity-feed"

// ─── Outbound gate (via ActivityCard) ──────────────────────────────────────

describe("ActivityCard email delivery affordances — outbound gate", () => {
  function emailEntry(direction: "outbound" | "inbound"): ActivityEntry {
    return {
      id: `email-${direction}`,
      kind: "email",
      timestamp: new Date("2026-07-07T12:00:00Z"),
      title: "Subject line",
      direction,
      // Delivery + open data is present for BOTH — so the only thing that can
      // suppress the chip/opens on inbound is the direction gate, not missing data.
      deliveryStatus: "delivered",
      openCount: 3,
      openHumanCount: 2,
      openBotCount: 1,
      openUnknownCount: 0,
    }
  }

  it("OUTBOUND email renders the delivery chip + opens affordance", () => {
    render(<ActivityCard entry={emailEntry("outbound")} collapsedAll={false} eventOptions={[]} />)
    expect(screen.getByTestId("delivery-status-chip-delivered")).toBeInTheDocument()
    expect(screen.getByTestId("opens-popout-trigger")).toBeInTheDocument()
  })

  it("INBOUND email renders NEITHER the delivery chip NOR the opens affordance", () => {
    render(<ActivityCard entry={emailEntry("inbound")} collapsedAll={false} eventOptions={[]} />)
    expect(screen.queryByTestId("delivery-status-chip-delivered")).not.toBeInTheDocument()
    expect(screen.queryByTestId("opens-popout-trigger")).not.toBeInTheDocument()
  })
})

// ─── DeliveryStatusChip ────────────────────────────────────────────────────

describe("DeliveryStatusChip", () => {
  describe("chip labels per status", () => {
    it.each([
      ["sent", "Sent"],
      ["delivered", "Delivered"],
      ["bounced", "Bounced"],
      ["failed", "Failed"],
      ["complained", "Spam complaint"],
    ] as const)("status=%s renders label %s", (status, label) => {
      render(<DeliveryStatusChip status={status} />)
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByTestId(`delivery-status-chip-${status}`)).toBeInTheDocument()
    })
  })

  describe("bounced + bounceReason", () => {
    it("includes bounceReason in the title attribute when present", () => {
      render(<DeliveryStatusChip status="bounced" bounceReason="Mailbox full" />)
      const chip = screen.getByTestId("delivery-status-chip-bounced")
      expect(chip).toHaveAttribute("title", "Mailbox full")
    })

    it("omits title attribute when bounceReason is absent", () => {
      render(<DeliveryStatusChip status="bounced" />)
      const chip = screen.getByTestId("delivery-status-chip-bounced")
      expect(chip).not.toHaveAttribute("title")
    })
  })

  describe("failed with reason", () => {
    it("shows bounceReason in title for failed status", () => {
      render(<DeliveryStatusChip status="failed" bounceReason="SMTP timeout" />)
      const chip = screen.getByTestId("delivery-status-chip-failed")
      expect(chip).toHaveAttribute("title", "SMTP timeout")
    })
  })

  describe("complained with reason", () => {
    it("shows bounceReason in title for complained status", () => {
      render(<DeliveryStatusChip status="complained" bounceReason="Reported spam" />)
      const chip = screen.getByTestId("delivery-status-chip-complained")
      expect(chip).toHaveAttribute("title", "Reported spam")
    })
  })

  describe("graceful degradation", () => {
    it("renders nothing for null status", () => {
      const { container } = render(<DeliveryStatusChip status={null} />)
      expect(container.firstChild).toBeNull()
    })

    it("renders nothing for undefined status", () => {
      const { container } = render(<DeliveryStatusChip status={undefined} />)
      expect(container.firstChild).toBeNull()
    })

    it("renders nothing for an unknown status value", () => {
      const { container } = render(<DeliveryStatusChip status="unknown_future_value" />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe("color-class mapping", () => {
    it("applies emerald palette for delivered", () => {
      render(<DeliveryStatusChip status="delivered" />)
      expect(screen.getByTestId("delivery-status-chip-delivered").className).toMatch(/emerald/)
    })

    it("applies red palette for bounced", () => {
      render(<DeliveryStatusChip status="bounced" />)
      expect(screen.getByTestId("delivery-status-chip-bounced").className).toMatch(/red/)
    })

    it("applies red palette for failed", () => {
      render(<DeliveryStatusChip status="failed" />)
      expect(screen.getByTestId("delivery-status-chip-failed").className).toMatch(/red/)
    })

    it("applies red palette for complained", () => {
      render(<DeliveryStatusChip status="complained" />)
      expect(screen.getByTestId("delivery-status-chip-complained").className).toMatch(/red/)
    })
  })
})

// ─── OpensPopout ───────────────────────────────────────────────────────────

describe("OpensPopout", () => {
  describe("no-opens guard", () => {
    it("renders nothing when openCount is 0", () => {
      const { container } = render(<OpensPopout openCount={0} />)
      expect(container.firstChild).toBeNull()
    })

    it("renders nothing when openCount is null", () => {
      const { container } = render(<OpensPopout openCount={null} />)
      expect(container.firstChild).toBeNull()
    })

    it("renders nothing when openCount is undefined", () => {
      const { container } = render(<OpensPopout />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe("trigger renders when openCount > 0", () => {
    it("shows the trigger with the openCount", () => {
      render(<OpensPopout openCount={3} openHumanCount={1} openBotCount={1} openUnknownCount={1} />)
      expect(screen.getByTestId("opens-popout-trigger")).toBeInTheDocument()
      expect(screen.getByTestId("opens-popout-trigger")).toHaveTextContent("Opens: 3")
    })
  })

  describe("expanded content", () => {
    it("clicking the trigger reveals the three-way split and honesty copy", () => {
      render(<OpensPopout openCount={5} openHumanCount={2} openBotCount={1} openUnknownCount={2} />)
      // Popout starts closed
      expect(screen.queryByTestId("opens-popout-content")).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId("opens-popout-trigger"))

      const content = screen.getByTestId("opens-popout-content")
      expect(content).toBeInTheDocument()

      // Three-way split
      const split = screen.getByTestId("opens-split")
      expect(split).toHaveTextContent("Likely Human · 2")
      expect(split).toHaveTextContent("Automated Open · 1")
      expect(split).toHaveTextContent("Unknown · 2")

      // Honesty copy
      const honesty = screen.getByTestId("opens-honesty-copy")
      expect(honesty).toHaveTextContent("Opens are an estimate.")
      expect(honesty).toHaveTextContent("Automated Open")
      expect(honesty).toHaveTextContent("bots/mail scanners")
      expect(honesty).toHaveTextContent("Unknown")
      expect(honesty).toHaveTextContent("Lean on clicks and replies for true engagement.")
    })

    it("zero counts display as 0 (not blank) when some buckets are empty", () => {
      render(<OpensPopout openCount={1} openHumanCount={1} openBotCount={0} openUnknownCount={0} />)
      fireEvent.click(screen.getByTestId("opens-popout-trigger"))
      const split = screen.getByTestId("opens-split")
      expect(split).toHaveTextContent("Automated Open · 0")
      expect(split).toHaveTextContent("Unknown · 0")
    })
  })
})
