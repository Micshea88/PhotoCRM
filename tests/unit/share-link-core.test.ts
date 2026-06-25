/**
 * Unit tests for the pure share-link core (Commit 3): expiration resolution
 * for the 16 dropdown options + the passcode rate-limit math (5/15min → 30min).
 */
import { describe, it, expect } from "vitest"
import {
  resolveExpiration,
  isExpired,
  registerFailedAttempt,
  attemptsRemaining,
  isLocked,
  lockoutMinutesRemaining,
  SHARE_LINK_EXPIRATION_OPTIONS,
  DEFAULT_SHARE_LINK_EXPIRATION,
  PASSCODE_MAX_ATTEMPTS,
} from "@/modules/files/share-link-core"

const NOW = new Date("2026-06-24T12:00:00.000Z")

describe("resolveExpiration", () => {
  it("has 16 options, default '1 month'", () => {
    expect(SHARE_LINK_EXPIRATION_OPTIONS).toHaveLength(16)
    expect(DEFAULT_SHARE_LINK_EXPIRATION).toBe("1 month")
  })
  it("days / weeks", () => {
    expect(resolveExpiration("1 day", NOW)).toEqual(new Date("2026-06-25T12:00:00.000Z"))
    expect(resolveExpiration("6 days", NOW)).toEqual(new Date("2026-06-30T12:00:00.000Z"))
    expect(resolveExpiration("1 week", NOW)).toEqual(new Date("2026-07-01T12:00:00.000Z"))
    expect(resolveExpiration("3 weeks", NOW)).toEqual(new Date("2026-07-15T12:00:00.000Z"))
  })
  it("months / year (calendar)", () => {
    expect(resolveExpiration("1 month", NOW)).toEqual(new Date("2026-07-24T12:00:00.000Z"))
    expect(resolveExpiration("6 months", NOW)).toEqual(new Date("2026-12-24T12:00:00.000Z"))
    expect(resolveExpiration("1 year", NOW)).toEqual(new Date("2027-06-24T12:00:00.000Z"))
  })
  it("never expires → null; custom date passes through", () => {
    expect(resolveExpiration("Never expires", NOW)).toBeNull()
    expect(resolveExpiration("Custom date…", NOW, "2026-08-01")).toEqual(new Date("2026-08-01"))
  })
  it("custom date requires a valid value", () => {
    expect(() => resolveExpiration("Custom date…", NOW)).toThrow()
    expect(() => resolveExpiration("Custom date…", NOW, "not-a-date")).toThrow()
  })
  it("isExpired: null never expires; past expires", () => {
    expect(isExpired(null, NOW)).toBe(false)
    expect(isExpired(new Date("2026-06-23T12:00:00Z"), NOW)).toBe(true)
    expect(isExpired(new Date("2026-06-25T12:00:00Z"), NOW)).toBe(false)
  })
})

describe("passcode rate limiting", () => {
  it("increments within the 15-min window", () => {
    const r = registerFailedAttempt(
      { failedAttempts: 2, lastAttemptAt: new Date(NOW.getTime() - 60_000) },
      NOW,
    )
    expect(r.failedAttempts).toBe(3)
    expect(r.lockedUntil).toBeNull()
  })
  it("resets to 1 when the last attempt was outside the window", () => {
    const r = registerFailedAttempt(
      { failedAttempts: 4, lastAttemptAt: new Date(NOW.getTime() - 16 * 60_000) },
      NOW,
    )
    expect(r.failedAttempts).toBe(1)
  })
  it("locks for 30 min on the 5th attempt", () => {
    const r = registerFailedAttempt(
      { failedAttempts: 4, lastAttemptAt: new Date(NOW.getTime() - 60_000) },
      NOW,
    )
    expect(r.failedAttempts).toBe(PASSCODE_MAX_ATTEMPTS)
    expect(r.lockedUntil).toEqual(new Date(NOW.getTime() + 30 * 60_000))
  })
  it("attemptsRemaining + isLocked + countdown", () => {
    expect(attemptsRemaining(2)).toBe(3)
    expect(attemptsRemaining(5)).toBe(0)
    expect(isLocked(new Date(NOW.getTime() + 60_000), NOW)).toBe(true)
    expect(isLocked(new Date(NOW.getTime() - 60_000), NOW)).toBe(false)
    expect(isLocked(null, NOW)).toBe(false)
    expect(lockoutMinutesRemaining(new Date(NOW.getTime() + 25 * 60_000), NOW)).toBe(25)
    expect(lockoutMinutesRemaining(null, NOW)).toBe(0)
  })
})
