/**
 * Unit tests for the notification type registry and computeScheduledFor helper.
 * Task 10a — pure functions only (no DB, no mailer).
 * Task 15F — expanded registry: 21 types, 6 categories.
 */
import { describe, it, expect } from "vitest"
import {
  NOTIFICATION_TYPES,
  NEEDS_ACTION_TYPES,
  getNotificationTypeMeta,
  computeScheduledFor,
} from "@/modules/notifications/types"
import type { NotificationSettings } from "@/modules/notifications/types"

// ---------------------------------------------------------------------------
// Registry — Task 15F expanded registry
// ---------------------------------------------------------------------------

describe("NOTIFICATION_TYPES registry", () => {
  it("contains exactly 21 entries", () => {
    expect(Object.keys(NOTIFICATION_TYPES)).toHaveLength(21)
  })

  it("contains all expected type keys", () => {
    const keys = Object.keys(NOTIFICATION_TYPES).sort()
    expect(keys).toEqual([
      "account.security",
      "booking.cancelled",
      "booking.made",
      "call.completed",
      "contract.signed",
      "email.bounced",
      "email.clicked",
      "email.complained",
      "email.disconnected",
      "email.opened",
      "email.reply_received",
      "email.send_failed",
      "form.completed",
      "form.started",
      "lead.new_inquiry",
      "lead.untouched_reminder",
      "meeting.notes_ready",
      "payment.failed",
      "payment.received",
      "proposal.viewed",
      "sms.received",
    ])
  })

  it("all 6 NotificationCategory values are represented", () => {
    const categories = new Set(Object.values(NOTIFICATION_TYPES).map((v) => v.category))
    expect(categories).toContain("messages_email")
    expect(categories).toContain("payments")
    expect(categories).toContain("documents")
    expect(categories).toContain("leads")
    expect(categories).toContain("scheduling")
    expect(categories).toContain("system")
    expect(categories.size).toBe(6)
  })

  // ── messages_email types ──────────────────────────────────────────────────

  it("email.bounced has correct shape", () => {
    const entry = NOTIFICATION_TYPES["email.bounced"]
    expect(entry.category).toBe("messages_email")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Email bounced")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("email.complained has correct shape", () => {
    const entry = NOTIFICATION_TYPES["email.complained"]
    expect(entry.category).toBe("messages_email")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Spam complaint")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("email.send_failed has correct shape", () => {
    const entry = NOTIFICATION_TYPES["email.send_failed"]
    expect(entry.category).toBe("messages_email")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Email failed to send")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("email.reply_received has correct shape (email default now ON per spec)", () => {
    const entry = NOTIFICATION_TYPES["email.reply_received"]
    expect(entry.category).toBe("messages_email")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("New email reply")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("email.clicked has correct shape", () => {
    const entry = NOTIFICATION_TYPES["email.clicked"]
    expect(entry.category).toBe("messages_email")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Link clicked")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(false)
  })

  it("email.opened has both defaults OFF (log-only, no emitter)", () => {
    const entry = NOTIFICATION_TYPES["email.opened"]
    expect(entry.category).toBe("messages_email")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Email opened")
    expect(entry.defaultChannels).toEqual({ in_app: false, email: false })
    expect(entry.needsAction).toBe(false)
  })

  it("sms.received has correct shape", () => {
    const entry = NOTIFICATION_TYPES["sms.received"]
    expect(entry.category).toBe("messages_email")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Text received")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  // ── system types ──────────────────────────────────────────────────────────

  it("email.disconnected has correct shape", () => {
    const entry = NOTIFICATION_TYPES["email.disconnected"]
    expect(entry.category).toBe("system")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Email inbox disconnected")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("account.security has correct shape", () => {
    const entry = NOTIFICATION_TYPES["account.security"]
    expect(entry.category).toBe("system")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Account & security")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  // ── payments types ────────────────────────────────────────────────────────

  it("payment.received has correct shape", () => {
    const entry = NOTIFICATION_TYPES["payment.received"]
    expect(entry.category).toBe("payments")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Payment received")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(false)
  })

  it("payment.failed has correct shape", () => {
    const entry = NOTIFICATION_TYPES["payment.failed"]
    expect(entry.category).toBe("payments")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Payment failed")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  // ── documents types ───────────────────────────────────────────────────────

  it("proposal.viewed has correct shape", () => {
    const entry = NOTIFICATION_TYPES["proposal.viewed"]
    expect(entry.category).toBe("documents")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Proposal viewed")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(false)
  })

  it("form.started has correct shape (bell-only default, no needsAction)", () => {
    const entry = NOTIFICATION_TYPES["form.started"]
    expect(entry.category).toBe("documents")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Form started")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: false })
    expect(entry.needsAction).toBe(false)
  })

  it("form.completed has correct shape", () => {
    const entry = NOTIFICATION_TYPES["form.completed"]
    expect(entry.category).toBe("documents")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Form completed")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("contract.signed has correct shape", () => {
    const entry = NOTIFICATION_TYPES["contract.signed"]
    expect(entry.category).toBe("documents")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Contract signed")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(false)
  })

  // ── leads types ───────────────────────────────────────────────────────────

  it("lead.new_inquiry has correct shape", () => {
    const entry = NOTIFICATION_TYPES["lead.new_inquiry"]
    expect(entry.category).toBe("leads")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("New inquiry")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("lead.untouched_reminder has correct shape", () => {
    const entry = NOTIFICATION_TYPES["lead.untouched_reminder"]
    expect(entry.category).toBe("leads")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Untouched-lead reminder")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  // ── scheduling types ──────────────────────────────────────────────────────

  it("booking.made has correct shape", () => {
    const entry = NOTIFICATION_TYPES["booking.made"]
    expect(entry.category).toBe("scheduling")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Booking made")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(false)
  })

  it("booking.cancelled has correct shape", () => {
    const entry = NOTIFICATION_TYPES["booking.cancelled"]
    expect(entry.category).toBe("scheduling")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Booking cancelled")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("call.completed has correct shape", () => {
    const entry = NOTIFICATION_TYPES["call.completed"]
    expect(entry.category).toBe("scheduling")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Call completed")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(false)
  })

  it("meeting.notes_ready has correct shape", () => {
    const entry = NOTIFICATION_TYPES["meeting.notes_ready"]
    expect(entry.category).toBe("scheduling")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("Meeting notes ready")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// NEEDS_ACTION_TYPES
// ---------------------------------------------------------------------------

describe("NEEDS_ACTION_TYPES", () => {
  it("contains exactly the types with needsAction=true", () => {
    const expectedNeedsAction = Object.entries(NOTIFICATION_TYPES)
      .filter(([, v]) => v.needsAction)
      .map(([k]) => k)
      .sort()

    expect([...NEEDS_ACTION_TYPES].sort()).toEqual(expectedNeedsAction)
  })

  it("includes all delivery-critical types", () => {
    expect(NEEDS_ACTION_TYPES).toContain("email.bounced")
    expect(NEEDS_ACTION_TYPES).toContain("email.complained")
    expect(NEEDS_ACTION_TYPES).toContain("email.send_failed")
    expect(NEEDS_ACTION_TYPES).toContain("email.disconnected")
    expect(NEEDS_ACTION_TYPES).toContain("account.security")
    expect(NEEDS_ACTION_TYPES).toContain("payment.failed")
  })

  it("does NOT include log-only or routine info types", () => {
    expect(NEEDS_ACTION_TYPES).not.toContain("email.opened")
    expect(NEEDS_ACTION_TYPES).not.toContain("email.clicked")
    expect(NEEDS_ACTION_TYPES).not.toContain("payment.received")
    expect(NEEDS_ACTION_TYPES).not.toContain("proposal.viewed")
    expect(NEEDS_ACTION_TYPES).not.toContain("form.started")
    expect(NEEDS_ACTION_TYPES).not.toContain("contract.signed")
    expect(NEEDS_ACTION_TYPES).not.toContain("booking.made")
    expect(NEEDS_ACTION_TYPES).not.toContain("call.completed")
    expect(NEEDS_ACTION_TYPES).not.toContain("meeting.notes_ready")
  })
})

// ---------------------------------------------------------------------------
// getNotificationTypeMeta
// ---------------------------------------------------------------------------

describe("getNotificationTypeMeta", () => {
  it("returns the registry entry for a known type", () => {
    const meta = getNotificationTypeMeta("email.bounced")
    expect(meta.label).toBe("Email bounced")
    expect(meta.tier).toBe("critical")
  })

  it("throws for an unknown type", () => {
    expect(() => getNotificationTypeMeta("lead.assigned")).toThrow(
      "Unknown notification type: lead.assigned",
    )
    expect(() => getNotificationTypeMeta("")).toThrow("Unknown notification type: ")
  })
})

// ---------------------------------------------------------------------------
// computeScheduledFor
// ---------------------------------------------------------------------------

const quietSettings: NotificationSettings = {
  timezone: "UTC",
  quietHoursStart: 22,
  quietHoursEnd: 7,
  digestFrequency: "off",
}

const nonWrappingSettings: NotificationSettings = {
  timezone: "UTC",
  quietHoursStart: 9,
  quietHoursEnd: 17,
  digestFrequency: "off",
}

describe("computeScheduledFor", () => {
  it("critical tier → null even when quiet hours are configured", () => {
    const now = new Date("2026-01-15T23:00:00Z")
    expect(computeScheduledFor(quietSettings, "critical", now)).toBeNull()
  })

  it("routine + null settings → null (immediate)", () => {
    const now = new Date("2026-01-15T23:00:00Z")
    expect(computeScheduledFor(null, "routine", now)).toBeNull()
  })

  it("routine + null quietHoursStart → null (immediate)", () => {
    const settings: NotificationSettings = {
      timezone: "UTC",
      quietHoursStart: null,
      quietHoursEnd: 7,
      digestFrequency: "off",
    }
    const now = new Date("2026-01-15T23:00:00Z")
    expect(computeScheduledFor(settings, "routine", now)).toBeNull()
  })

  it("routine + null quietHoursEnd → null (immediate)", () => {
    const settings: NotificationSettings = {
      timezone: "UTC",
      quietHoursStart: 22,
      quietHoursEnd: null,
      digestFrequency: "off",
    }
    const now = new Date("2026-01-15T23:00:00Z")
    expect(computeScheduledFor(settings, "routine", now)).toBeNull()
  })

  describe("wrapping midnight window (22–7 UTC)", () => {
    it("23:00 UTC → inside window, returns 07:00 next morning", () => {
      const now = new Date("2026-01-15T23:00:00Z")
      const result = computeScheduledFor(quietSettings, "routine", now)
      expect(result).not.toBeNull()
      // Should be 2026-01-16T07:00:00Z
      expect(result!.toISOString()).toBe("2026-01-16T07:00:00.000Z")
    })

    it("01:00 UTC → inside window (past midnight), returns 07:00 same day", () => {
      const now = new Date("2026-01-16T01:00:00Z")
      const result = computeScheduledFor(quietSettings, "routine", now)
      expect(result).not.toBeNull()
      expect(result!.toISOString()).toBe("2026-01-16T07:00:00.000Z")
    })

    it("12:00 UTC → outside window, returns null", () => {
      const now = new Date("2026-01-15T12:00:00Z")
      expect(computeScheduledFor(quietSettings, "routine", now)).toBeNull()
    })

    it("22:00 UTC exactly → inside window (start is inclusive)", () => {
      const now = new Date("2026-01-15T22:00:00Z")
      const result = computeScheduledFor(quietSettings, "routine", now)
      expect(result).not.toBeNull()
      expect(result!.toISOString()).toBe("2026-01-16T07:00:00.000Z")
    })

    it("07:00 UTC exactly → outside window (end is exclusive)", () => {
      const now = new Date("2026-01-15T07:00:00Z")
      expect(computeScheduledFor(quietSettings, "routine", now)).toBeNull()
    })
  })

  describe("non-wrapping window (9–17 UTC)", () => {
    it("10:00 UTC → inside window, returns 17:00 today", () => {
      const now = new Date("2026-01-15T10:00:00Z")
      const result = computeScheduledFor(nonWrappingSettings, "routine", now)
      expect(result).not.toBeNull()
      expect(result!.toISOString()).toBe("2026-01-15T17:00:00.000Z")
    })

    it("18:00 UTC → outside window, returns null", () => {
      const now = new Date("2026-01-15T18:00:00Z")
      expect(computeScheduledFor(nonWrappingSettings, "routine", now)).toBeNull()
    })

    it("09:00 UTC exactly → inside window (start inclusive)", () => {
      const now = new Date("2026-01-15T09:00:00Z")
      const result = computeScheduledFor(nonWrappingSettings, "routine", now)
      expect(result).not.toBeNull()
      expect(result!.toISOString()).toBe("2026-01-15T17:00:00.000Z")
    })

    it("17:00 UTC exactly → outside window (end exclusive)", () => {
      const now = new Date("2026-01-15T17:00:00Z")
      expect(computeScheduledFor(nonWrappingSettings, "routine", now)).toBeNull()
    })

    it("08:00 UTC → outside window (before start)", () => {
      const now = new Date("2026-01-15T08:00:00Z")
      expect(computeScheduledFor(nonWrappingSettings, "routine", now)).toBeNull()
    })
  })

  describe("timezone: America/New_York", () => {
    it("reads the hour in the recipient timezone, not UTC", () => {
      // America/New_York is UTC-5 in January (EST).
      // 01:00 UTC = 20:00 (8 PM) previous day in New York.
      // Quiet window 22–7 NY time: 20:00 is outside → should return null.
      const nySettings: NotificationSettings = {
        timezone: "America/New_York",
        quietHoursStart: 22,
        quietHoursEnd: 7,
        digestFrequency: "off",
      }
      const now = new Date("2026-01-15T01:00:00Z") // 20:00 NY
      expect(computeScheduledFor(nySettings, "routine", now)).toBeNull()
    })

    it("23:00 NY time → inside window, returns 07:00 NY (next morning)", () => {
      // 23:00 New York EST = 04:00 UTC next day
      const nySettings: NotificationSettings = {
        timezone: "America/New_York",
        quietHoursStart: 22,
        quietHoursEnd: 7,
        digestFrequency: "off",
      }
      // 2026-01-15T23:00:00 EST = 2026-01-16T04:00:00Z
      const now = new Date("2026-01-16T04:00:00Z")
      const result = computeScheduledFor(nySettings, "routine", now)
      expect(result).not.toBeNull()
      // 07:00 EST on 2026-01-16 = 2026-01-16T12:00:00Z
      expect(result!.toISOString()).toBe("2026-01-16T12:00:00.000Z")
    })
  })

  it("settings.timezone null → falls back to UTC", () => {
    const settings: NotificationSettings = {
      timezone: null,
      quietHoursStart: 22,
      quietHoursEnd: 7,
      digestFrequency: "off",
    }
    // 23:00 UTC → inside window → returns 07:00 UTC next day
    const now = new Date("2026-01-15T23:00:00Z")
    const result = computeScheduledFor(settings, "routine", now)
    expect(result).not.toBeNull()
    expect(result!.toISOString()).toBe("2026-01-16T07:00:00.000Z")
  })
})
