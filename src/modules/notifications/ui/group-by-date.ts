import type { NotificationWithContact } from "@/modules/notifications/queries"

// ---------------------------------------------------------------------------
// Date grouping — shared by the dropdown and the full-page view
// ---------------------------------------------------------------------------

export interface NotificationGroup {
  label: string
  items: NotificationWithContact[]
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

/** Midnight of the given date in local time. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Compute the bucket label for a notification `createdAt` relative to `now`.
 *
 * Buckets (newest to oldest):
 *   Today                    — same calendar day as `now`
 *   Yesterday                — one day before today
 *   Mon–Sun                  — weekday name for the remaining days in the last 7
 *   MMM D                    — older items still in the current year (e.g. "Jul 2")
 *   MMM D, YYYY              — items from prior years (e.g. "Dec 14, 2025")
 */
function bucketLabel(itemDate: Date, now: Date): string {
  const todayStart = startOfDay(now)
  const itemStart = startOfDay(itemDate)
  const diffMs = todayStart.getTime() - itemStart.getTime()
  const diffDays = Math.round(diffMs / 86_400_000)

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays >= 2 && diffDays <= 6) {
    return WEEKDAY_NAMES[itemDate.getDay()] as string
  }
  // Older within current year
  const month = MONTH_NAMES[itemDate.getMonth()] as string
  const day = String(itemDate.getDate())
  if (itemDate.getFullYear() === now.getFullYear()) {
    return `${month} ${day}`
  }
  // Prior year
  return `${month} ${day}, ${String(itemDate.getFullYear())}`
}

/**
 * Groups notifications into dated buckets relative to `now` (defaults to the
 * real clock; inject a fixed value in tests for deterministic assertions).
 *
 * Buckets, newest-first:
 *   Today → Yesterday → weekday names (Mon–Sun) → MMM D → MMM D, YYYY
 *
 * The return shape is unchanged from the original (label + items[]); callers
 * that already render groups need no update.
 */
export function groupByDate(
  items: NotificationWithContact[],
  now: Date = new Date(),
): NotificationGroup[] {
  // Accumulate groups preserving insertion order (items arrive newest-first
  // from the query, so the first group seen is always the newest bucket).
  const groupMap = new Map<string, NotificationWithContact[]>()

  for (const n of items) {
    const label = bucketLabel(new Date(n.createdAt), now)
    const existing = groupMap.get(label)
    if (existing) {
      existing.push(n)
    } else {
      groupMap.set(label, [n])
    }
  }

  return Array.from(groupMap.entries()).map(([label, groupItems]) => ({
    label,
    items: groupItems,
  }))
}
