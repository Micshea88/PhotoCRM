import type { NotificationWithContact } from "@/modules/notifications/queries"

// ---------------------------------------------------------------------------
// Date grouping — shared by the dropdown and the full-page view
// ---------------------------------------------------------------------------

export interface NotificationGroup {
  label: string
  items: NotificationWithContact[]
}

/**
 * Groups notifications into "Today", "Earlier this week", and "Older" buckets
 * relative to the viewer's local clock.
 */
export function groupByDate(items: NotificationWithContact[]): NotificationGroup[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - ((todayStart.getDay() + 6) % 7)) // Monday

  const today: NotificationWithContact[] = []
  const thisWeek: NotificationWithContact[] = []
  const older: NotificationWithContact[] = []

  for (const n of items) {
    const d = new Date(n.createdAt)
    if (d >= todayStart) {
      today.push(n)
    } else if (d >= weekStart) {
      thisWeek.push(n)
    } else {
      older.push(n)
    }
  }

  const groups: NotificationGroup[] = []
  if (today.length > 0) groups.push({ label: "Today", items: today })
  if (thisWeek.length > 0) groups.push({ label: "Earlier this week", items: thisWeek })
  if (older.length > 0) groups.push({ label: "Older", items: older })
  return groups
}
