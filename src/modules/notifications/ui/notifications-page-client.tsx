"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { Settings } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { markAllNotificationsRead } from "@/modules/notifications/actions"
import type { NotificationWithContact } from "@/modules/notifications/queries"
import { NotificationRow } from "./notification-row"
import {
  NotificationFilterStrip,
  EMPTY_NOTIFICATION_FILTER,
  filterStateToApiParams,
  type NotificationFilterState,
} from "./notification-filter-strip"

type NotificationTab = "all" | "unread" | "needs_attention" | "archive"

const TABS: { value: NotificationTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "archive", label: "Archive" },
]

interface NotificationsApiResponse {
  notifications: NotificationWithContact[]
  unreadCount: number
}

interface NotificationGroup {
  label: string
  items: NotificationWithContact[]
}

function groupByDate(items: NotificationWithContact[]): NotificationGroup[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - ((todayStart.getDay() + 6) % 7))

  const today: NotificationWithContact[] = []
  const thisWeek: NotificationWithContact[] = []
  const older: NotificationWithContact[] = []

  for (const n of items) {
    const d = new Date(n.createdAt)
    if (d >= todayStart) today.push(n)
    else if (d >= weekStart) thisWeek.push(n)
    else older.push(n)
  }

  const groups: NotificationGroup[] = []
  if (today.length > 0) groups.push({ label: "Today", items: today })
  if (thisWeek.length > 0) groups.push({ label: "Earlier this week", items: thisWeek })
  if (older.length > 0) groups.push({ label: "Older", items: older })
  return groups
}

function buildFetchUrl(tab: NotificationTab, filter: NotificationFilterState): string {
  const params = new URLSearchParams({ tab })
  const extra = filterStateToApiParams(filter)
  for (const [k, v] of Object.entries(extra)) params.set(k, v)
  params.set("limit", "100")
  return `/api/notifications?${params.toString()}`
}

/**
 * Full-page notifications client component. Mirrors the dropdown but is
 * full-width and URL-param-aware per tab/filter state.
 *
 * Note: setState is only called inside async .then() / .catch() chains, never
 * synchronously in the effect body (satisfies react-hooks/set-state-in-effect).
 */
export function NotificationsPageClient() {
  const [tab, setTab] = useState<NotificationTab>("all")
  const [filter, setFilter] = useState<NotificationFilterState>(EMPTY_NOTIFICATION_FILTER)
  // null = initial loading (show skeleton)
  const [items, setItems] = useState<NotificationWithContact[] | null>(null)
  const [, startTransition] = useTransition()

  const doFetch = useCallback((t: NotificationTab, f: NotificationFilterState) => {
    void fetch(buildFetchUrl(t, f))
      .then((r) =>
        r.ok
          ? (r.json() as Promise<NotificationsApiResponse>)
          : Promise.reject(new Error(String(r.status))),
      )
      .then((data) => {
        setItems(data.notifications)
      })
      .catch(() => {
        setItems([])
      })
  }, [])

  useEffect(() => {
    doFetch(tab, filter)
  }, [tab, filter, doFetch])

  function handleMarkAllRead() {
    startTransition(() => {
      void markAllNotificationsRead({}).then((res) => {
        if (!res.serverError) doFetch(tab, filter)
      })
    })
  }

  const groups = items ? groupByDate(items) : []
  const loading = items === null

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Tabs + header actions */}
      <div className="flex items-center justify-between gap-4">
        <div
          className="flex border-b border-[var(--color-border)]"
          role="tablist"
          aria-label="Notification tabs"
        >
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => {
                setTab(t.value)
                setFilter(EMPTY_NOTIFICATION_FILTER)
              }}
              className={cn(
                "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                tab === t.value
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
              )}
              data-testid={`page-tab-${t.value}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
            Mark all read
          </Button>
          <Link
            href="/settings/notifications"
            className="flex size-8 items-center justify-center rounded-md text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)]/40 hover:text-[var(--color-foreground)]"
            aria-label="Notification settings"
          >
            <Settings className="size-4" />
          </Link>
        </div>
      </div>

      {/* Filter strip */}
      <NotificationFilterStrip state={filter} onChange={setFilter} />

      {/* List */}
      <div className="rounded-md border border-[var(--color-border)]">
        {loading ? (
          <div className="space-y-px p-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                <div className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-[var(--color-muted)]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--color-muted)]" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-[var(--color-muted)]" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <p className="text-sm font-medium">You&apos;re all caught up</p>
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
              No notifications to show
            </p>
          </div>
        ) : (
          <div role="list">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="bg-[var(--color-muted)]/30 px-4 py-1.5 text-[10px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                  {group.label}
                </div>
                {group.items.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    onRefresh={() => {
                      doFetch(tab, filter)
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
