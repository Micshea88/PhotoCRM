"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { Settings } from "lucide-react"
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotificationTab = "all" | "unread" | "needs_attention" | "archive"

const TABS: { value: NotificationTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "archive", label: "Archive" },
]

// ---------------------------------------------------------------------------
// API response type
// ---------------------------------------------------------------------------

interface NotificationsApiResponse {
  notifications: NotificationWithContact[]
  unreadCount: number
}

// ---------------------------------------------------------------------------
// Date grouping
// ---------------------------------------------------------------------------

interface NotificationGroup {
  label: string
  items: NotificationWithContact[]
}

function groupByDate(items: NotificationWithContact[]): NotificationGroup[] {
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

// ---------------------------------------------------------------------------
// Build the URL for a given tab + filter state
// ---------------------------------------------------------------------------

function buildFetchUrl(tab: NotificationTab, filter: NotificationFilterState): string {
  const params = new URLSearchParams({ tab })
  const extra = filterStateToApiParams(filter)
  for (const [k, v] of Object.entries(extra)) params.set(k, v)
  params.set("limit", "50")
  return `/api/notifications?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface NotificationDropdownProps {
  onUnreadCountChange: (count: number) => void
  onClose?: () => void
}

/**
 * Full notification dropdown panel: tabs, filter strip, date-grouped list,
 * "Mark all read", gear link, and "See all" footer.
 *
 * Note: setState is only called inside async .then() / .catch() chains, never
 * synchronously in the effect body (satisfies react-hooks/set-state-in-effect).
 */
export function NotificationDropdown({ onUnreadCountChange, onClose }: NotificationDropdownProps) {
  const [tab, setTab] = useState<NotificationTab>("all")
  const [filter, setFilter] = useState<NotificationFilterState>(EMPTY_NOTIFICATION_FILTER)
  // null = initial loading (show skeleton); array = loaded (may be empty)
  const [items, setItems] = useState<NotificationWithContact[] | null>(null)
  const [, startTransition] = useTransition()

  const doFetch = useCallback(
    (t: NotificationTab, f: NotificationFilterState) => {
      const url = buildFetchUrl(t, f)
      void fetch(url)
        .then((r) =>
          r.ok
            ? (r.json() as Promise<NotificationsApiResponse>)
            : Promise.reject(new Error(String(r.status))),
        )
        .then((data) => {
          setItems(data.notifications)
          onUnreadCountChange(data.unreadCount)
        })
        .catch(() => {
          setItems([])
        })
    },
    [onUnreadCountChange],
  )

  // Fetch on mount + whenever tab/filter changes.
  // No synchronous setState in the effect body — all setState calls happen
  // inside .then() / .catch() above (async microtask boundary).
  useEffect(() => {
    doFetch(tab, filter)
  }, [tab, filter, doFetch])

  function handleTabChange(next: NotificationTab) {
    setTab(next)
    setFilter(EMPTY_NOTIFICATION_FILTER)
  }

  function handleFilterChange(next: NotificationFilterState) {
    setFilter(next)
  }

  function handleMarkAllRead() {
    startTransition(() => {
      void markAllNotificationsRead({}).then((res) => {
        if (!res.serverError) doFetch(tab, filter)
      })
    })
  }

  function handleRefresh() {
    doFetch(tab, filter)
  }

  const groups = items ? groupByDate(items) : []
  const loading = items === null

  return (
    <div className="flex w-[400px] flex-col" data-testid="notification-dropdown">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <span className="text-sm font-semibold">Notifications</span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleMarkAllRead}
            data-testid="mark-all-read"
          >
            Mark all read
          </Button>
          <Link
            href="/settings/notifications"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40 hover:text-[var(--color-foreground)]"
            aria-label="Notification settings"
            data-testid="notification-settings-link"
          >
            <Settings className="size-4" />
          </Link>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div
        className="flex border-b border-[var(--color-border)] px-4"
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
              handleTabChange(t.value)
            }}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
              tab === t.value
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
            data-testid={`tab-${t.value}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Filter strip ── */}
      <div className="border-b border-[var(--color-border)] px-4 py-2">
        <NotificationFilterStrip state={filter} onChange={handleFilterChange} />
      </div>

      {/* ── Notification list ── */}
      <div className="max-h-[480px] overflow-y-auto" role="list">
        {loading ? (
          <NotificationSkeleton />
        ) : items.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center px-4 py-12 text-center"
            data-testid="notifications-empty"
          >
            <p className="text-sm font-medium">You&apos;re all caught up</p>
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
              No notifications to show
            </p>
          </div>
        ) : (
          <div className="py-1">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="px-4 py-1.5 text-[10px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                  {group.label}
                </div>
                {group.items.map((n) => (
                  <NotificationRow key={n.id} notification={n} onRefresh={handleRefresh} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="border-t border-[var(--color-border)] px-4 py-2.5">
        <Link
          href="/notifications"
          onClick={onClose}
          className="text-xs font-medium text-[var(--color-primary)] hover:underline"
          data-testid="see-all-notifications"
        >
          See all notifications →
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function NotificationSkeleton() {
  return (
    <div
      className="space-y-px py-1"
      aria-label="Loading notifications"
      data-testid="notification-skeleton"
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-2.5">
          <div className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-[var(--color-muted)]" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--color-muted)]" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-[var(--color-muted)]" />
          </div>
        </div>
      ))}
    </div>
  )
}
