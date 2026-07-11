"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Bell,
  BellRing,
  Archive,
  ArchiveRestore,
  CheckSquare,
  Clock,
  CalendarDays,
} from "lucide-react"
import * as RadixPopover from "@radix-ui/react-popover"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  markNotificationRead,
  markNotificationUnread,
  archiveNotification,
  snoozeNotification,
  createTaskFromNotification,
} from "@/modules/notifications/actions"
import type { NotificationWithContact } from "@/modules/notifications/queries"
import { NOTIFICATION_TYPES } from "@/modules/notifications/types"

// Export Bell so the import is not unused (it's re-exported for use elsewhere)
export { Bell }

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local datetime-input helper
// ---------------------------------------------------------------------------

/**
 * Returns a "YYYY-MM-DDTHH:mm" string in LOCAL time — the format required by
 * <input type="datetime-local"> min/value props.  toISOString() is UTC and
 * would set the min attribute hours into the future in negative-offset zones.
 */
export function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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
// Snooze options — 4 presets with resolved datetime labels
// ---------------------------------------------------------------------------

export interface SnoozeOption {
  label: string
  computeUntil: (now: Date) => Date
}

export const SNOOZE_OPTIONS: SnoozeOption[] = [
  {
    label: "Later today",
    computeUntil: (now) => new Date(now.getTime() + 3 * 60 * 60 * 1000),
  },
  {
    label: "Tomorrow",
    computeUntil: (now) => {
      const d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(8, 0, 0, 0)
      return d
    },
  },
  {
    label: "In 2 days",
    computeUntil: (now) => {
      const d = new Date(now)
      d.setDate(d.getDate() + 2)
      d.setHours(8, 0, 0, 0)
      return d
    },
  },
  {
    label: "Next week",
    computeUntil: (now) => {
      const d = new Date(now)
      // Always advance to the next Monday (even if today IS Monday)
      const daysUntilMonday = (8 - d.getDay()) % 7 || 7
      d.setDate(d.getDate() + daysUntilMonday)
      d.setHours(8, 0, 0, 0)
      return d
    },
  },
]

/**
 * Format a snooze target date for display next to the preset label.
 * "Later today" shows only the time (same day); others show weekday + date + time.
 */
export function formatSnoozeDate(date: Date, now: Date = new Date()): string {
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) {
    return date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })
  }
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface NotificationRowProps {
  notification: NotificationWithContact
  onRefresh: () => void
  /** When provided, shows a "Wake now" button + the snoozedUntil time on the row. */
  onUnsnooze?: () => void
  /**
   * When provided, shows an "Unarchive" / "Restore" button on the row.
   * Gate to the Archive tab by only passing this prop when tab === "archive".
   */
  onUnarchive?: () => void
  /**
   * Called after a successful single-row archive with the archived notification id.
   * Used by the page to show the undo snackbar.
   */
  onArchived?: (ids: string[]) => void
  /**
   * Page-mode selection props — only the /notifications page passes these.
   * The bell dropdown does NOT pass them, so no checkboxes appear there.
   *
   * `selectable` enables the leading checkbox.
   * `selected`   reflects whether this row is currently checked.
   * `onToggleSelect` is called with the notification id when the checkbox changes.
   */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  /**
   * Section E4 — density prop.
   * When true, reduces vertical padding and gap for a more compact layout.
   * The bell dropdown does NOT pass this (stays comfortable by default).
   */
  compact?: boolean
}

/**
 * 3-layer notification row (headline / detail / anchor + relative time).
 * Hover reveals 4 action buttons: mark unread, snooze, create task, archive.
 *
 * The snooze menu uses @radix-ui/react-popover (portaled) so it escapes the
 * dropdown's overflow-y-auto container and is never clipped.
 */
export function NotificationRow({
  notification: n,
  onRefresh,
  onUnsnooze,
  onUnarchive,
  onArchived,
  selectable,
  selected,
  onToggleSelect,
  compact = false,
}: NotificationRowProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [customValue, setCustomValue] = useState("")
  // Read state with an optimistic override so the persistent read/unread toggle
  // (+ the unread dot) flip in lockstep on click, before the refetch lands.
  const serverRead = n.readAt !== null
  const [optimisticRead, setOptimisticRead] = useState<boolean | null>(null)
  const isRead = optimisticRead ?? serverRead
  // When the server truth changes (readAt crosses the null boundary, e.g. after
  // refetch or a "mark all" elsewhere), drop the override so server wins.
  // Deferred to a microtask to satisfy react-hooks/set-state-in-effect (the
  // module convention — same as the density mount-read effect).
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) setOptimisticRead(null)
    })
    return () => {
      active = false
    }
  }, [serverRead])

  function handleMarkRead() {
    setError(null)
    setOptimisticRead(true)
    startTransition(() => {
      void markNotificationRead({ id: n.id }).then((res) => {
        if (res.serverError) {
          setError(res.serverError)
          setOptimisticRead(null)
        } else {
          onRefresh()
        }
      })
    })
  }

  function handleMarkUnread() {
    setError(null)
    setOptimisticRead(false)
    startTransition(() => {
      void markNotificationUnread({ id: n.id }).then((res) => {
        if (res.serverError) {
          setError(res.serverError)
          setOptimisticRead(null)
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
          onArchived?.([n.id])
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

  function handleSnoozePreset(option: SnoozeOption) {
    const until = option.computeUntil(new Date())
    setError(null)
    setSnoozeOpen(false)
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

  function handleSnoozeCustom() {
    if (!customValue) return
    const until = new Date(customValue)
    if (isNaN(until.getTime())) return
    setError(null)
    setSnoozeOpen(false)
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
    if (n.linkPath) {
      router.push(n.linkPath)
    }
  }

  // Safe lookup that handles unknown type keys (category can be any string from DB)
  const typeLabel =
    (NOTIFICATION_TYPES as Record<string, { label: string } | undefined>)[n.type]?.label ?? n.type

  // Compute preset dates once per render so JSX stays readable
  const now = new Date()
  const presets = SNOOZE_OPTIONS.map((opt) => ({ opt, until: opt.computeUntil(now) }))

  return (
    <div
      role="listitem"
      className={cn(
        "group relative flex cursor-pointer items-start rounded-md px-3 transition-colors hover:bg-[var(--color-accent)]/30",
        compact ? "gap-2 py-1.5" : "gap-3 py-2.5",
        !isRead && "bg-[var(--color-accent)]/10",
      )}
      data-testid="notification-row"
      data-unread={!isRead ? "true" : "false"}
      onClick={handleRowClick}
    >
      {/* Per-row selection checkbox — page-mode only; hidden in the bell dropdown */}
      {selectable && (
        <div
          className="flex shrink-0 items-center self-stretch pr-1"
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={() => {
              onToggleSelect?.(n.id)
            }}
            aria-label={`Select notification: ${n.title}`}
            data-testid="notification-select-checkbox"
            className="size-4 cursor-pointer rounded border-[var(--color-border)] accent-[var(--color-primary)]"
          />
        </div>
      )}

      {/* Read / unread indicator dot — only rendered when unread */}
      {!isRead && (
        <div className="mt-1.5 shrink-0">
          <div
            className="size-2 rounded-full bg-blue-500"
            data-testid="notification-read-dot"
            aria-label="Unread"
          />
        </div>
      )}

      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-0.5">
        {/* Line 1 — headline */}
        <p
          className={cn("truncate text-sm leading-snug", !isRead && "font-medium")}
          data-testid="notification-title"
        >
          {n.title}
        </p>

        {/* Line 2 — detail (body). Compact clamps the preview to ONE line
            (Gmail-style), collapsing the row toward a single scannable line;
            comfortable keeps two lines. The preview is always shown — it's what
            signals whether a notification matters without opening it. */}
        {n.body && (
          <p
            className={cn(
              "text-xs text-[var(--color-muted-foreground)]",
              compact ? "line-clamp-1" : "line-clamp-2",
            )}
            data-testid="notification-body"
          >
            {n.body}
          </p>
        )}

        {/* Line 3 — bottom line (HoneyBook): anchor + timestamp on the LEFT
            (always visible), the read/unread link on the RIGHT (hover-revealed),
            at OPPOSITE edges so they never crowd. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)]">
            <span className="truncate" data-testid="notification-anchor">
              {n.contactName ? (
                <span className="text-[var(--color-foreground)]">{n.contactName}</span>
              ) : (
                <span>{typeLabel}</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums" data-testid="notification-time">
              {relativeTime(new Date(n.createdAt))}
            </span>
          </div>
          {/* Read/unread link — RIGHT edge, hover-revealed. State-dependent;
              clicking flips read state + the unread dot in lockstep, stopPropagation. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (isRead) handleMarkUnread()
              else handleMarkRead()
            }}
            aria-label={isRead ? "Mark as unread" : "Mark as read"}
            data-testid="row-read-toggle"
            className="hidden shrink-0 text-[11px] font-medium text-[var(--color-primary)] hover:underline group-hover:inline"
          >
            {isRead ? "Mark as unread" : "Mark as read"}
          </button>
        </div>

        {/* Snoozed-until indicator — only shown on the Snoozed tab */}
        {onUnsnooze && n.snoozedUntil && (
          <div
            className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"
            data-testid="notification-snooze-until"
          >
            <Clock className="size-3 shrink-0" />
            <span>Wakes {formatSnoozeDate(new Date(n.snoozedUntil), now)}</span>
          </div>
        )}
      </div>

      {/* Hover action buttons — rendered INSIDE the row (a right-aligned flex
          member revealed on hover), NOT a floating bordered overlay. No box,
          border or shadow; the content reflows so the icons never obscure text. */}
      <div
        className="hidden shrink-0 items-center gap-0.5 self-center group-hover:flex"
        data-testid="notification-actions"
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {/* Wake now (unsnooze) — only shown on the Snoozed tab */}
        {onUnsnooze && (
          <Tooltip label="Wake now">
            <button
              type="button"
              onClick={onUnsnooze}
              className="flex size-7 items-center justify-center rounded-sm text-amber-600 hover:bg-[var(--color-accent)]/40 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
              aria-label="Wake now"
              data-testid="action-unsnooze"
            >
              <BellRing className="size-3.5" />
            </button>
          </Tooltip>
        )}

        {/* Unarchive (restore) — only shown on the Archive tab */}
        {onUnarchive && (
          <Tooltip label="Unarchive">
            <button
              type="button"
              onClick={onUnarchive}
              className="flex size-7 items-center justify-center rounded-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40 hover:text-[var(--color-foreground)]"
              aria-label="Unarchive"
              data-testid="action-unarchive"
            >
              <ArchiveRestore className="size-3.5" />
            </button>
          </Tooltip>
        )}

        {/* Mark read/unread lives OUTSIDE this hover cluster — it is a hover-revealed
            text link on Line 3, by the timestamp (see above). */}

        {/* Snooze — hidden on the Archive tab (snoozing an already-archived
            item is meaningless) AND on the Snoozed tab (the row is already
            snoozed; "Wake now" is offered there instead). Portaled so it isn't
            clipped by the dropdown. */}
        {!onUnarchive && !onUnsnooze && (
          <RadixPopover.Root open={snoozeOpen} onOpenChange={setSnoozeOpen}>
          <Tooltip label="Snooze">
            <RadixPopover.Trigger asChild>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40 hover:text-[var(--color-foreground)]"
                aria-label="Snooze"
                data-testid="action-snooze"
              >
                <Clock className="size-3.5" />
              </button>
            </RadixPopover.Trigger>
          </Tooltip>

          <RadixPopover.Portal>
            <RadixPopover.Content
              align="end"
              side="bottom"
              collisionPadding={8}
              sideOffset={4}
              className="z-50 min-w-[220px] rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-1 shadow-lg"
              data-testid="snooze-menu"
              onCloseAutoFocus={(e) => {
                e.preventDefault()
              }}
            >
              {/* 4 presets */}
              <ul className="space-y-0.5" data-testid="snooze-presets">
                {presets.map(({ opt, until }) => (
                  <li key={opt.label}>
                    <button
                      type="button"
                      onClick={() => {
                        handleSnoozePreset(opt)
                      }}
                      className="flex w-full items-center justify-between gap-4 rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--color-accent)]/40"
                      data-testid={`snooze-preset-${opt.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <span className="font-medium">{opt.label}</span>
                      <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                        {formatSnoozeDate(until, now)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {/* Divider before custom picker */}
              <div className="my-1 border-t border-[var(--color-border)]" />

              {/* Custom date + time picker */}
              <div
                className="flex items-center gap-2 rounded px-3 py-1.5 hover:bg-[var(--color-accent)]/40"
                data-testid="snooze-custom-row"
              >
                <CalendarDays className="size-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">Pick date &amp; time&hellip;</span>
                  <input
                    type="datetime-local"
                    value={customValue}
                    onChange={(e) => {
                      setCustomValue(e.target.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSnoozeCustom()
                    }}
                    className="w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1 py-0.5 text-xs text-[var(--color-foreground)] focus:ring-1 focus:ring-[var(--color-primary)] focus:outline-none"
                    data-testid="snooze-custom-input"
                    aria-label="Pick snooze date and time"
                    min={toLocalDatetimeValue(new Date())}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSnoozeCustom}
                  disabled={!customValue}
                  className="shrink-0 rounded bg-[var(--color-primary)] px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                  data-testid="snooze-custom-confirm"
                >
                  Set
                </button>
              </div>
            </RadixPopover.Content>
          </RadixPopover.Portal>
          </RadixPopover.Root>
        )}

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

        {/* Archive — hidden on the Archive tab (row is already archived;
            re-archiving would fire a confusing "Archived 1" undo toast).
            Unarchive is offered instead, above. */}
        {!onUnarchive && (
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
        )}
      </div>

      {error && <p className="absolute right-3 bottom-1 text-[10px] text-red-500">{error}</p>}
    </div>
  )
}
