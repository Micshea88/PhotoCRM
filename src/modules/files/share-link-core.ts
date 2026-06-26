/**
 * Pure share-link logic (Commit 3, Mike-locked 2026-06-24): expiration option
 * resolution + passcode rate-limit math. No I/O / no crypto / no server-only,
 * so the composer + settings dropdowns and the public verify route all share
 * it, and it unit-tests directly.
 */

/** The 16 natural-language expiration options, in dropdown order. "1 month" is
 *  the default (decision). "Custom date…" + "Never expires" are special-cased. */
export const SHARE_LINK_EXPIRATION_OPTIONS = [
  "1 day",
  "2 days",
  "3 days",
  "4 days",
  "5 days",
  "6 days",
  "1 week",
  "2 weeks",
  "3 weeks",
  "1 month",
  "2 months",
  "3 months",
  "6 months",
  "1 year",
  "Custom date…",
  "Never expires",
] as const

export type ShareLinkExpirationOption = (typeof SHARE_LINK_EXPIRATION_OPTIONS)[number]
export const DEFAULT_SHARE_LINK_EXPIRATION: ShareLinkExpirationOption = "1 month"

const DAY_MS = 24 * 60 * 60 * 1000

function addMonths(d: Date, n: number): Date {
  // UTC arithmetic so expiry is deterministic regardless of server timezone /
  // DST (local setMonth would shift the absolute hour across a DST boundary).
  const r = new Date(d)
  r.setUTCMonth(r.getUTCMonth() + n)
  return r
}

/**
 * Resolve an expiration option to an absolute Date, or null for "Never
 * expires". For "Custom date…" the caller supplies `customDate` (YYYY-MM-DD or
 * ISO); an unparseable/absent custom date throws (the action validates first).
 */
export function resolveExpiration(
  option: string,
  now: Date,
  customDate?: string | null,
): Date | null {
  switch (option) {
    case "Never expires":
      return null
    case "Custom date…": {
      if (!customDate) throw new Error("Custom expiration requires a date.")
      const d = new Date(customDate)
      if (Number.isNaN(d.getTime())) throw new Error("Invalid custom expiration date.")
      return d
    }
    case "1 day":
      return new Date(now.getTime() + 1 * DAY_MS)
    case "2 days":
      return new Date(now.getTime() + 2 * DAY_MS)
    case "3 days":
      return new Date(now.getTime() + 3 * DAY_MS)
    case "4 days":
      return new Date(now.getTime() + 4 * DAY_MS)
    case "5 days":
      return new Date(now.getTime() + 5 * DAY_MS)
    case "6 days":
      return new Date(now.getTime() + 6 * DAY_MS)
    case "1 week":
      return new Date(now.getTime() + 7 * DAY_MS)
    case "2 weeks":
      return new Date(now.getTime() + 14 * DAY_MS)
    case "3 weeks":
      return new Date(now.getTime() + 21 * DAY_MS)
    case "1 month":
      return addMonths(now, 1)
    case "2 months":
      return addMonths(now, 2)
    case "3 months":
      return addMonths(now, 3)
    case "6 months":
      return addMonths(now, 6)
    case "1 year":
      return addMonths(now, 12)
    default:
      throw new Error(`Unknown expiration option: ${option}`)
  }
}

export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt != null && expiresAt.getTime() <= now.getTime()
}

/** Relative path to a share link's public landing page. Pure (no origin) so the
 *  client feed can build an href; the server prefixes appBase() for emails. */
export function shareLinkPath(token: string): string {
  return `/api/share-link/${encodeURIComponent(token)}`
}

// ─── Passcode rate limiting (PCI-style: 5 wrong / 15 min → 30 min lockout) ──

export const PASSCODE_MAX_ATTEMPTS = 5
export const PASSCODE_WINDOW_MS = 15 * 60 * 1000
export const PASSCODE_LOCKOUT_MS = 30 * 60 * 1000

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil != null && lockedUntil.getTime() > now.getTime()
}

export function attemptsRemaining(failedAttempts: number): number {
  return Math.max(0, PASSCODE_MAX_ATTEMPTS - failedAttempts)
}

/** Minutes (rounded up) until an active lockout clears — for the countdown. */
export function lockoutMinutesRemaining(lockedUntil: Date | null, now: Date): number {
  if (lockedUntil == null) return 0
  const ms = lockedUntil.getTime() - now.getTime()
  return ms > 0 ? Math.ceil(ms / (60 * 1000)) : 0
}

export interface LockState {
  failedAttempts: number
  lockedUntil: Date | null
}

/**
 * Compute the next lock state after a wrong passcode. The 15-min window is
 * anchored on the last attempt time (the row's updatedAt) — an attempt outside
 * the window resets the count to 1. Reaching the max sets a 30-min lockout.
 */
export function registerFailedAttempt(
  prev: { failedAttempts: number; lastAttemptAt: Date | null },
  now: Date,
): LockState {
  const withinWindow =
    prev.lastAttemptAt != null && now.getTime() - prev.lastAttemptAt.getTime() <= PASSCODE_WINDOW_MS
  const failedAttempts = withinWindow ? prev.failedAttempts + 1 : 1
  const lockedUntil =
    failedAttempts >= PASSCODE_MAX_ATTEMPTS ? new Date(now.getTime() + PASSCODE_LOCKOUT_MS) : null
  return { failedAttempts, lockedUntil }
}
