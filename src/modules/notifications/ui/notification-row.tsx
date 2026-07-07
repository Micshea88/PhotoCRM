"use client"

import { useState, useTransition } from "react"
import { Bell, BellOff, Archive, CheckSquare, Clock } from "lucide-react"
import { Tooltip } from "@/components/ui/tooltip"
import { Popover } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  markNotificationRead,
  markNotificationUnread,
  archiveNotification,
  snoozeNotification,
  createTaskFromNotification,
} from "@/modules/notifications/actions"
import type { NotificationWithContact } from "@/modules/notifications/queries"
import { NOTIFICATION_TYPES, type NotificationCategory } from "@/modules/notifications/types"

// Export Bell so the import is not unused (it's re-exported for use elsewhere)
export { Bell }

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

export function relativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${String(diffMin)}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${String(diffH)}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${String(diffD)}d ago`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// ---------------------------------------------------------------------------
// Category → dot color
// ---------------------------------------------------------------------------

// Using Partial so TypeScript allows unknown category strings from the DB
const CATEGORY_DOT_CLASS: Partial<Record<NotificationCategory, string>> = {
  messages_email: "bg-blue-500",
  payments: "bg-green-500",
  documents: "bg-orange-500",
  leads: "bg-purple-500",
  scheduling: "bg-teal-500",
  system: "bg-[var(--color-muted-foreground)]",
}

function categoryDotClass(category: string, tier: string): string {
  if (tier === "critical") return "bg-red-500"
  return (
    (CATEGORY_DOT_CLASS as Record<string, string | undefined>)[category] ??
    "bg-[var(--color-muted-foreground)]"
  )
}

// ---------------------------------------------------------------------------
// Snooze options
// ---------------------------------------------------------------------------

interface SnoozeOption {
  label: string
  computeUntil: (now: Date) => Date
}

const SNOOZE_OPTIONS: SnoozeOption[] = [
  {
    label: "1 hour",
    computeUntil: (now) => new Date(now.getTime() + 60 * 60 * 1000),
  },
  {
    label: "Tomorrow",
    computeUntil: (now) => {
      const d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
  {
    label: "Next week",
    computeUntil: (now) => {
      const d = new Date(now)
      const daysUntilMonday = (8 - d.getDay()) % 7 || 7
      d.setDate(d.getDate() + daysUntilMonday)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface NotificationRowProps {
  notification: NotificationWithContact
  onRefresh: () => void
}

/**
 * 3-layer notification row (headline / detail / anchor + relative time).
 * Hover reveals 4 action buttons: mark unread, snooze, create task, archive.
 */
export function NotificationRow({ notification: n, onRefresh }: NotificationRowProps) {
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const isRead = n.readAt !== null

  function handleMarkUnread() {
    setError(null)
    startTransition(() => {
      void markNotificationUnread({ id: n.id }).then((res) => {
        if (res.serverError) {
          setError(res.serverError)
        } else {
          onRefresh()
        }
      })
    })
  }

  function handleArchive() {
    setError(null)
    startTransition(() => {
      void archiveNotification({ id: n.id }).then((res) => {
        if (res.serverError) {
          setError(res.serverError)
        } else {
          onRefresh()
        }
      })
    })
  }

  function handleCreateTask() {
    if (!n.contactId) return
    setError(null)
    startTransition(() => {
      void createTaskFromNotification({ id: n.id }).then((res) => {
        if (res.serverError) {
          setError(res.serverError)
        } else {
          onRefresh()
        }
      })
    })
  }

  function handleSnooze(option: SnoozeOption) {
    const until = option.computeUntil(new Date())
    setError(null)
    startTransition(() => {
      void snoozeNotification({ id: n.id, until }).then((res) => {
        if (res.serverError) {
          setError(res.serverError)
        } else {
          onRefresh()
        }
      })
    })
  }

  function handleRowClick() {
    if (!isRead) {
      startTransition(() => {
        void markNotificationRead({ id: n.id }).then((res) => {
          if (!res.serverError) onRefresh()
        })
      })
    }
  }

  const dotClass = categoryDotClass(n.category, n.tier)
  // Safe lookup that handles unknown type keys (category can be any string from DB)
  const typeLabel =
    (NOTIFICATION_TYPES as Record<string, { label: string } | undefined>)[n.type]?.label ?? n.type

  return (
    <div
      role="listitem"
      className={cn(
        "group relative flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-[var(--color-accent)]/30",
        !isRead && "bg-[var(--color-accent)]/10",
      )}
      data-testid="notification-row"
      data-unread={!isRead ? "true" : "false"}
      onClick={handleRowClick}
    >
      {/* Read / unread indicator dot */}
      <div className="mt-1.5 shrink-0">
        <div
          className={cn(
            "size-2 rounded-full",
            isRead ? "ring-1 ring-[var(--color-border)]" : dotClass,
          )}
          data-testid="notification-read-dot"
          aria-label={isRead ? "Read" : "Unread"}
        />
      </div>

      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-0.5">
        {/* Line 1 — headline */}
        <p
          className={cn("truncate text-sm leading-snug", !isRead && "font-medium")}
          data-testid="notification-title"
        >
          <span
            className={cn(
              "mr-1.5 inline-block size-2 shrink-0 rounded-full align-middle",
              dotClass,
            )}
          />
          {n.title}
        </p>

        {/* Line 2 — detail (body) */}
        {n.body && (
          <p
            className="line-clamp-2 text-xs text-[var(--color-muted-foreground)]"
            data-testid="notification-body"
          >
            {n.body}
          </p>
        )}

        {/* Line 3 — anchor (contact name) + relative time */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="truncate text-[11px] text-[var(--color-muted-foreground)]"
            data-testid="notification-anchor"
          >
            {n.contactName ? (
              <span className="text-[var(--color-foreground)]">{n.contactName}</span>
            ) : (
              <span>{typeLabel}</span>
            )}
          </span>
          <span
            className="shrink-0 text-[11px] text-[var(--color-muted-foreground)] tabular-nums"
            data-testid="notification-time"
          >
            {relativeTime(new Date(n.createdAt))}
          </span>
        </div>
      </div>

      {/* Hover action buttons */}
      <div
        className="absolute top-2 right-2 hidden items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] shadow-sm group-hover:flex"
        data-testid="notification-actions"
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {/* Mark unread */}
        <Tooltip label="Mark unread">
          <button
            type="button"
            onClick={handleMarkUnread}
            className="flex size-7 items-center justify-center rounded-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40 hover:text-[var(--color-foreground)]"
            aria-label="Mark unread"
            data-testid="action-mark-unread"
          >
            <BellOff className="size-3.5" />
          </button>
        </Tooltip>

        {/* Snooze */}
        <Popover
          align="end"
          className="p-1"
          trigger={({ toggle }) => (
            <Tooltip label="Snooze">
              <button
                type="button"
                onClick={toggle}
                className="flex size-7 items-center justify-center rounded-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40 hover:text-[var(--color-foreground)]"
                aria-label="Snooze"
                data-testid="action-snooze"
              >
                <Clock className="size-3.5" />
              </button>
            </Tooltip>
          )}
        >
          {({ close }) => (
            <ul className="space-y-0.5">
              {SNOOZE_OPTIONS.map((opt) => (
                <li key={opt.label}>
                  <button
                    type="button"
                    onClick={() => {
                      handleSnooze(opt)
                      close()
                    }}
                    className="flex w-full rounded px-3 py-1 text-left text-sm hover:bg-[var(--color-accent)]/40"
                  >
                    {opt.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>

        {/* Create task */}
        <Tooltip label={n.contactId ? "Create task" : "No linked contact"}>
          <button
            type="button"
            onClick={handleCreateTask}
            disabled={!n.contactId}
            className={cn(
              "flex size-7 items-center justify-center rounded-sm hover:bg-[var(--color-accent)]/40",
              n.contactId
                ? "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                : "cursor-not-allowed text-[var(--color-muted-foreground)]/40",
            )}
            aria-label="Create task"
            aria-disabled={!n.contactId}
            data-testid="action-create-task"
          >
            <CheckSquare className="size-3.5" />
          </button>
        </Tooltip>

        {/* Archive */}
        <Tooltip label="Archive">
          <button
            type="button"
            onClick={handleArchive}
            className="flex size-7 items-center justify-center rounded-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40 hover:text-[var(--color-foreground)]"
            aria-label="Archive"
            data-testid="action-archive"
          >
            <Archive className="size-3.5" />
          </button>
        </Tooltip>
      </div>

      {error && <p className="absolute right-3 bottom-1 text-[10px] text-red-500">{error}</p>}
    </div>
  )
}
