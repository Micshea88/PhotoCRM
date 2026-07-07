/**
 * Task 10a — Notification type registry + computeScheduledFor pure helper.
 *
 * PURE — no DB, no mailer, no server-only. Only built-in Intl is used for
 * timezone-aware hour resolution. Task 10b (dispatch.ts / email.ts) imports
 * from this file.
 */

// ---------------------------------------------------------------------------
// Type aliases
// ---------------------------------------------------------------------------

export type NotificationChannel = "in_app" | "email"
export type NotificationCategory = "system" | "client" | "lead" | "project" | "payment"
export type NotificationTier = "critical" | "routine"

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = {
  "email.bounced": {
    category: "client" as NotificationCategory,
    tier: "critical" as NotificationTier,
    label: "Email bounced",
    defaultChannels: { in_app: true, email: true },
    needsAction: true,
  },
  "email.complained": {
    category: "client" as NotificationCategory,
    tier: "critical" as NotificationTier,
    label: "Spam complaint",
    defaultChannels: { in_app: true, email: true },
    needsAction: true,
  },
  "email.send_failed": {
    category: "client" as NotificationCategory,
    tier: "critical" as NotificationTier,
    label: "Email failed to send",
    defaultChannels: { in_app: true, email: true },
    needsAction: true,
  },
  "email.disconnected": {
    category: "system" as NotificationCategory,
    tier: "critical" as NotificationTier,
    label: "Email inbox disconnected",
    defaultChannels: { in_app: true, email: true },
    needsAction: true,
  },
  "email.reply_received": {
    category: "client" as NotificationCategory,
    tier: "routine" as NotificationTier,
    label: "New email reply",
    defaultChannels: { in_app: true, email: false },
    needsAction: true,
  },
}

export type NotificationType = keyof typeof NOTIFICATION_TYPES

/**
 * Task 14 — derived list of type keys whose `needsAction === true`.
 * Used by listNotifications (preset="needs_attention") and by the UI bell badge.
 *
 * NOTE: As of Task 10a, all registered types have needsAction=true, so
 * NEEDS_ACTION_TYPES equals Object.keys(NOTIFICATION_TYPES). This is accurate
 * and intentional — extend NOTIFICATION_TYPES with needsAction=false entries as
 * the product grows and this list will automatically stay correct.
 */
export const NEEDS_ACTION_TYPES: string[] = Object.entries(NOTIFICATION_TYPES)
  .filter(([, v]) => v.needsAction)
  .map(([k]) => k)

// ---------------------------------------------------------------------------
// Settings interface
// ---------------------------------------------------------------------------

export interface NotificationSettings {
  timezone: string | null
  quietHoursStart: number | null
  quietHoursEnd: number | null
  digestFrequency: "off" | "daily" | "weekly"
}

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------

export function getNotificationTypeMeta(
  type: string,
): (typeof NOTIFICATION_TYPES)[NotificationType] {
  if (type in NOTIFICATION_TYPES) {
    return NOTIFICATION_TYPES[type as NotificationType]
  }
  throw new Error("Unknown notification type: " + type)
}

// ---------------------------------------------------------------------------
// computeScheduledFor — quiet-hours deferral (pure)
// ---------------------------------------------------------------------------

/**
 * Returns the UTC Date at which a routine notification should be delivered,
 * accounting for quiet-hours deferral. Returns null for immediate delivery.
 *
 * Rules:
 * - critical tier → always null (immediate).
 * - routine + no settings or no quiet hours configured → null (immediate).
 * - routine + inside quiet window → Date of next quietHoursEnd:00 in timezone.
 * - routine + outside quiet window → null (immediate).
 *
 * The only time source is the passed `now`. No side effects.
 */
export function computeScheduledFor(
  settings: NotificationSettings | null,
  tier: NotificationTier,
  now: Date,
): Date | null {
  if (tier === "critical") return null

  if (settings === null) return null
  if (settings.quietHoursStart === null || settings.quietHoursEnd === null) return null

  const timezone = settings.timezone ?? "UTC"
  const currentHour = getLocalHour(now, timezone)
  const { quietHoursStart, quietHoursEnd } = settings

  if (!isInQuietWindow(currentHour, quietHoursStart, quietHoursEnd)) return null

  return buildNextOccurrenceOfHour(now, timezone, quietHoursEnd)
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported — pure functions)
// ---------------------------------------------------------------------------

/**
 * Returns true if `hour` falls inside the quiet window [start, end).
 * Handles windows that wrap midnight (e.g. start=22, end=7).
 */
function isInQuietWindow(hour: number, start: number, end: number): boolean {
  if (start < end) {
    // Non-wrapping: e.g. 9–17
    return hour >= start && hour < end
  }
  // Wrapping midnight: e.g. 22–7
  return hour >= start || hour < end
}

/**
 * Returns the local clock hour (0–23) of `date` in `timezone`,
 * using Intl.DateTimeFormat. Normalises the "24" Intl can return at midnight.
 */
function getLocalHour(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date)
  const h = parts.find((p) => p.type === "hour")?.value ?? "0"
  return Number(h) % 24
}

/**
 * Returns the next UTC Date corresponding to `targetHour`:00:00 in `timezone`
 * that is strictly after `now`. Tries today first, then tomorrow.
 */
/** Extracts a named part from `Intl.DateTimeFormat.formatToParts` output. */
function getDatePart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const part = parts.find((p) => p.type === type)
  if (part === undefined) throw new Error(`Intl.DateTimeFormat missing part: ${type}`)
  return Number(part.value)
}

function buildNextOccurrenceOfHour(now: Date, timezone: string, targetHour: number): Date {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)

  const year = getDatePart(dateParts, "year")
  const month = getDatePart(dateParts, "month")
  const day = getDatePart(dateParts, "day")

  const todayCandidate = buildDateAtLocalHour(year, month, day, targetHour, timezone)
  if (todayCandidate > now) return todayCandidate

  return buildDateAtLocalHour(year, month, day + 1, targetHour, timezone)
}

/**
 * Returns the UTC Date corresponding to `hour`:00:00 on the given local
 * year/month/day in `timezone`. Uses Intl to resolve the UTC offset at that
 * moment, with a single DST-correction pass.
 */
function buildDateAtLocalHour(
  year: number,
  month: number,
  day: number,
  hour: number,
  timezone: string,
): Date {
  // Start with the naive assumption that "local = UTC" to get a rough estimate,
  // then shift by the actual UTC offset at that estimate.
  const estimate = new Date(Date.UTC(year, month - 1, day, hour))
  const localHour = getLocalHour(estimate, timezone)
  const diff = hour - localHour
  const adjusted = new Date(estimate.getTime() + diff * 3_600_000)
  // One correction pass handles DST boundary skips (e.g. clocks spring forward).
  const verifiedHour = getLocalHour(adjusted, timezone)
  if (verifiedHour !== hour % 24) {
    return new Date(adjusted.getTime() + (hour - verifiedHour) * 3_600_000)
  }
  return adjusted
}
