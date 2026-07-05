/**
 * Unit tests for the notification type registry and computeScheduledFor helper.
 * Task 10a — pure functions only (no DB, no mailer).
 */
import { describe, it, expect } from "vitest"
import {
  NOTIFICATION_TYPES,
  getNotificationTypeMeta,
  computeScheduledFor,
} from "@/modules/notifications/types"
import type { NotificationSettings } from "@/modules/notifications/types"

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("NOTIFICATION_TYPES registry", () => {
  it("contains exactly 5 entries", () => {
    expect(Object.keys(NOTIFICATION_TYPES)).toHaveLength(5)
    expect(Object.keys(NOTIFICATION_TYPES).sort()).toEqual([
      "email.bounced",
      "email.complained",
      "email.disconnected",
      "email.reply_received",
      "email.send_failed",
    ])
  })

  it("email.bounced has correct shape", () => {
    const entry = NOTIFICATION_TYPES["email.bounced"]
    expect(entry.category).toBe("client")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Email bounced")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("email.complained has correct shape", () => {
    const entry = NOTIFICATION_TYPES["email.complained"]
    expect(entry.category).toBe("client")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Spam complaint")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("email.send_failed has correct shape", () => {
    const entry = NOTIFICATION_TYPES["email.send_failed"]
    expect(entry.category).toBe("client")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Email failed to send")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("email.disconnected has correct shape", () => {
    const entry = NOTIFICATION_TYPES["email.disconnected"]
    expect(entry.category).toBe("system")
    expect(entry.tier).toBe("critical")
    expect(entry.label).toBe("Email inbox disconnected")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: true })
    expect(entry.needsAction).toBe(true)
  })

  it("email.reply_received is the only routine entry and has email:false", () => {
    const entry = NOTIFICATION_TYPES["email.reply_received"]
    expect(entry.category).toBe("client")
    expect(entry.tier).toBe("routine")
    expect(entry.label).toBe("New email reply")
    expect(entry.defaultChannels).toEqual({ in_app: true, email: false })
    expect(entry.needsAction).toBe(true)

    // All others must be critical
    const others = Object.entries(NOTIFICATION_TYPES).filter(
      ([key]) => key !== "email.reply_received",
    )
    for (const [, meta] of others) {
      expect(meta.tier).toBe("critical")
    }
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
