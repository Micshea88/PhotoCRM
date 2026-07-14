"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { Settings, Clock, CalendarDays } from "lucide-react"
import Link from "next/link"
import * as RadixPopover from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"
import {
  unsnoozeNotification,
  unarchiveNotification,
  unarchiveNotificationsBulk,
  markNotificationsReadBulk,
  markNotificationsUnreadBulk,
  snoozeNotificationsBulk,
  archiveNotificationsBulk,
} from "@/modules/notifications/actions"
import type { NotificationWithContact } from "@/modules/notifications/queries"
import {
  NotificationRow,
  SNOOZE_OPTIONS,
  formatSnoozeDate,
  toLocalDatetimeValue,
  type SnoozeOption,
} from "./notification-row"
import {
  NotificationFilterStrip,
  EMPTY_NOTIFICATION_FILTER,
  filterStateToApiParams,
  type NotificationFilterState,
  type NotificationContactOption,
} from "./notification-filter-strip"
import { groupByDate } from "./group-by-date"

type NotificationTab = "all" | "unread" | "needs_attention" | "archive" | "snoozed"

const TABS: { value: NotificationTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "archive", label: "Archive" },
  { value: "snoozed", label: "Snoozed" },
]

interface NotificationsApiResponse {
  notifications: NotificationWithContact[]
  unreadCount: number
  notificationContacts?: NotificationContactOption[]
}

function buildFetchUrl(tab: NotificationTab, filter: NotificationFilterState): string {
  const params = new URLSearchParams({ tab })
  const extra = filterStateToApiParams(filter)
  for (const [k, v] of Object.entries(extra)) params.set(k, v)
  params.set("limit", "100")
  // Archive and Snoozed don't surface a contact filter, so we skip the
  // contacts fetch for those tabs.
  if (tab !== "archive" && tab !== "snoozed") {
    params.set("includeContacts", "1")
  }
  return `/api/notifications?${params.toString()}`
}

// ---------------------------------------------------------------------------
// UndoSnackbar — fixed-position bottom-center notification with Undo action
// ---------------------------------------------------------------------------

const UNDO_TIMEOUT_MS = 6_000

interface UndoSnackbarProps {
  ids: string[]
  onUndo: () => void
  onDismiss: () => void
}

function UndoSnackbar({ ids, onUndo, onDismiss }: UndoSnackbarProps) {
  const label =
    ids.length === 1 ? "Archived 1 notification" : `Archived ${String(ids.length)} notifications`
  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 shadow-lg"
      role="status"
      aria-live="polite"
      data-testid="undo-snackbar"
    >
      <span className="text-sm text-[var(--color-foreground)]">{label}</span>
      <button
        type="button"
        onClick={onUndo}
        className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
        data-testid="undo-snackbar-btn"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        aria-label="Dismiss"
        data-testid="undo-snackbar-dismiss"
      >
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BulkSnoozeMenu — portaled Radix popover with 4 presets + custom picker
// ---------------------------------------------------------------------------

interface BulkSnoozeMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSnooze: (until: Date) => void
}

function BulkSnoozeMenu({ open, onOpenChange, onSnooze }: BulkSnoozeMenuProps) {
  const [customValue, setCustomValue] = useState("")
  const now = new Date()
  const presets = SNOOZE_OPTIONS.map((opt) => ({ opt, until: opt.computeUntil(now) }))

  function handlePreset(opt: SnoozeOption) {
    onSnooze(opt.computeUntil(new Date()))
    onOpenChange(false)
  }

  function handleCustom() {
    if (!customValue) return
    const until = new Date(customValue)
    if (isNaN(until.getTime())) return
    onSnooze(until)
    onOpenChange(false)
  }

  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--state-hover)]"
          aria-label="Snooze selected"
          data-testid="bulk-action-snooze"
        >
          <Clock className="size-3.5" />
          Snooze
        </button>
      </RadixPopover.Trigger>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          side="bottom"
          collisionPadding={8}
          sideOffset={4}
          className="z-50 min-w-[220px] rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-1 shadow-lg"
          data-testid="bulk-snooze-menu"
          onCloseAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          {/* 4 presets */}
          <ul className="space-y-0.5" data-testid="bulk-snooze-presets">
            {presets.map(({ opt, until }) => (
              <li key={opt.label}>
                <button
                  type="button"
                  onClick={() => {
                    handlePreset(opt)
                  }}
                  className="flex w-full items-center justify-between gap-4 rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--state-hover)]"
                  data-testid={`bulk-snooze-preset-${opt.label.toLowerCase().replace(/\s+/g, "-")}`}
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
            className="flex items-center gap-2 rounded px-3 py-1.5 hover:bg-[var(--state-hover)]"
            data-testid="bulk-snooze-custom-row"
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
                  if (e.key === "Enter") handleCustom()
                }}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1 py-0.5 text-xs text-[var(--color-foreground)] focus:ring-1 focus:ring-[var(--color-primary)] focus:outline-none"
                data-testid="bulk-snooze-custom-input"
                aria-label="Pick snooze date and time"
                min={toLocalDatetimeValue(new Date())}
              />
            </div>
            <button
              type="button"
              onClick={handleCustom}
              disabled={!customValue}
              className="shrink-0 rounded bg-[var(--color-primary)] px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              data-testid="bulk-snooze-custom-confirm"
            >
              Set
            </button>
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}

// ---------------------------------------------------------------------------
// BulkActionBar — shown when ≥1 row is selected
// ---------------------------------------------------------------------------

interface BulkActionBarProps {
  count: number
  onMarkRead: () => void
  onMarkUnread: () => void
  onSnooze: (until: Date) => void
  onArchive: () => void
  onClear: () => void
}

function BulkActionBar({
  count,
  onMarkRead,
  onMarkUnread,
  onSnooze,
  onArchive,
  onClear,
}: BulkActionBarProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5 px-4 py-2"
      data-testid="bulk-action-bar"
    >
      <span
        className="min-w-[6ch] text-sm font-medium text-[var(--color-primary)]"
        data-testid="bulk-selected-count"
      >
        {count} selected
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onMarkRead}
          className="flex h-8 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--state-hover)]"
          data-testid="bulk-action-mark-read"
        >
          Mark read
        </button>

        <button
          type="button"
          onClick={onMarkUnread}
          className="flex h-8 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--state-hover)]"
          data-testid="bulk-action-mark-unread"
        >
          Mark unread
        </button>

        <BulkSnoozeMenu open={snoozeOpen} onOpenChange={setSnoozeOpen} onSnooze={onSnooze} />

        <button
          type="button"
          onClick={onArchive}
          className="flex h-8 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--state-hover)]"
          data-testid="bulk-action-archive"
        >
          Archive
        </button>

        <button
          type="button"
          onClick={onClear}
          className="flex h-8 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--state-hover)] hover:text-[var(--color-foreground)]"
          data-testid="bulk-action-clear"
        >
          Clear selection
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NotificationsPageClient
// ---------------------------------------------------------------------------

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
  // Distinct contacts from live notifications — used to populate the contact picker.
  const [contactOptions, setContactOptions] = useState<NotificationContactOption[]>([])
  // Section E3 — multi-select state: Set of selected notification IDs
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Section E5 — undo state: ids of the most recently archived notifications
  const [undoIds, setUndoIds] = useState<string[] | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
        // Reconcile the selection against what's now visible: a row that was
        // selected then individually mutated (archived/read) disappears on
        // refetch, so drop its id — otherwise the bulk bar shows an inflated
        // "N selected" until the next tab switch (Nit #2).
        const visible = new Set(data.notifications.map((n) => n.id))
        setSelectedIds((prev) => {
          const next = new Set([...prev].filter((id) => visible.has(id)))
          return next.size === prev.size ? prev : next
        })
        if (data.notificationContacts) {
          setContactOptions(data.notificationContacts)
        }
      })
      .catch(() => {
        setItems([])
      })
  }, [])

  useEffect(() => {
    doFetch(tab, filter)
  }, [tab, filter, doFetch])

  // ── undo snackbar helpers ───────────────────────────────────────────────────

  /** Show the undo snackbar for the given archived ids, resetting the 6s timer. */
  function showUndoSnackbar(ids: string[]) {
    // Clear any existing timer so a new archive resets the window
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current)
    }
    setUndoIds(ids)
    undoTimerRef.current = setTimeout(() => {
      setUndoIds(null)
      undoTimerRef.current = null
    }, UNDO_TIMEOUT_MS)
  }

  function dismissUndoSnackbar() {
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setUndoIds(null)
  }

  function handleUndo() {
    if (!undoIds) return
    const ids = undoIds
    dismissUndoSnackbar()
    startTransition(() => {
      const action =
        ids.length === 1 && ids[0] !== undefined
          ? unarchiveNotification({ id: ids[0] })
          : unarchiveNotificationsBulk({ ids })
      void action.then((res) => {
        if (!res.serverError) doFetch(tab, filter)
      })
    })
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        clearTimeout(undoTimerRef.current)
      }
    }
  }, [])

  // Unified mark-all toggle: acts on the CURRENTLY VISIBLE set (active tab +
  // filters) via the bulk actions — not all notifications globally. Marks all
  // read when any visible row is unread, else marks all unread.
  function handleMarkAllToggle() {
    const visible = items ?? []
    const ids = visible.map((n) => n.id)
    if (ids.length === 0) return
    const anyUnread = visible.some((n) => n.readAt === null)
    const run = anyUnread ? markNotificationsReadBulk : markNotificationsUnreadBulk
    startTransition(() => {
      void run({ ids }).then((res) => {
        if (!res.serverError) doFetch(tab, filter)
      })
    })
  }

  // ── selection helpers ───────────────────────────────────────────────────────

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  // ── bulk action handlers ────────────────────────────────────────────────────

  function handleBulkMarkRead() {
    const ids = [...selectedIds]
    startTransition(() => {
      void markNotificationsReadBulk({ ids }).then((res) => {
        if (!res.serverError) {
          clearSelection()
          doFetch(tab, filter)
        }
      })
    })
  }

  function handleBulkMarkUnread() {
    const ids = [...selectedIds]
    startTransition(() => {
      void markNotificationsUnreadBulk({ ids }).then((res) => {
        if (!res.serverError) {
          clearSelection()
          doFetch(tab, filter)
        }
      })
    })
  }

  function handleBulkSnooze(until: Date) {
    const ids = [...selectedIds]
    startTransition(() => {
      void snoozeNotificationsBulk({ ids, until }).then((res) => {
        if (!res.serverError) {
          clearSelection()
          doFetch(tab, filter)
        }
      })
    })
  }

  function handleBulkArchive() {
    const ids = [...selectedIds]
    startTransition(() => {
      void archiveNotificationsBulk({ ids }).then((res) => {
        if (!res.serverError) {
          clearSelection()
          showUndoSnackbar(ids)
          doFetch(tab, filter)
        }
      })
    })
  }

  const groups = items ? groupByDate(items) : []
  const loading = items === null
  const visibleItems = items ?? []
  const anyVisibleUnread = visibleItems.some((n) => n.readAt === null)

  return (
    // LAW 6: fluid full-width (matches the Contacts list). The former
    // `mx-auto max-w-2xl` pinned this to a 672px centered island with large
    // dead margins on wide screens. Interim per-page fix; the shared
    // PageContainer (see docs/theme-token-layer-plan.md) replaces this in the reskin.
    <div className="space-y-4">
      {/* Tabs + header actions — wrap on narrow viewports so the toolbar
          (tabs + mark-all-read + settings) never overflows (LAW 6). */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
                // Selection always resets on tab switch
                clearSelection()
                // Archive and Snoozed don't include a contact filter — clear
                // the picker and any active contactId so no stale pill lingers.
                if (t.value === "archive" || t.value === "snoozed") {
                  setContactOptions([])
                }
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
          {/* Plain text link (HoneyBook pattern), not a bordered button. */}
          <button
            type="button"
            onClick={handleMarkAllToggle}
            disabled={visibleItems.length === 0}
            data-testid="mark-all-toggle"
            className="text-sm font-medium text-[var(--color-primary)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--color-muted-foreground)] disabled:no-underline"
          >
            {anyVisibleUnread ? "Mark all read" : "Mark all unread"}
          </button>
          <Link
            href="/settings/notifications"
            className="flex size-8 items-center justify-center rounded-md text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--state-hover)] hover:text-[var(--color-foreground)]"
            aria-label="Notification settings"
          >
            <Settings className="size-4" />
          </Link>
        </div>
      </div>

      {/* Filter strip */}
      <NotificationFilterStrip
        state={filter}
        onChange={setFilter}
        contactOptions={contactOptions}
        showSearch={true}
        showSort={true}
      />

      {/* Bulk action bar — shown when ≥1 row is selected */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          onMarkRead={handleBulkMarkRead}
          onMarkUnread={handleBulkMarkUnread}
          onSnooze={handleBulkSnooze}
          onArchive={handleBulkArchive}
          onClear={clearSelection}
        />
      )}

      {/* Section E5 — undo snackbar (fixed-position, appears after archive) */}
      {undoIds && (
        <UndoSnackbar ids={undoIds} onUndo={handleUndo} onDismiss={dismissUndoSnackbar} />
      )}

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
                <div className="text-3xs bg-[var(--color-muted)]/30 px-4 py-1.5 font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                  {group.label}
                </div>
                {group.items.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    onRefresh={() => {
                      doFetch(tab, filter)
                    }}
                    onUnsnooze={
                      tab === "snoozed"
                        ? () => {
                            startTransition(() => {
                              void unsnoozeNotification({ id: n.id }).then((res) => {
                                if (!res.serverError) doFetch(tab, filter)
                              })
                            })
                          }
                        : undefined
                    }
                    onUnarchive={
                      tab === "archive"
                        ? () => {
                            startTransition(() => {
                              void unarchiveNotification({ id: n.id }).then((res) => {
                                if (!res.serverError) doFetch(tab, filter)
                              })
                            })
                          }
                        : undefined
                    }
                    onArchived={showUndoSnackbar}
                    selectable={true}
                    selected={selectedIds.has(n.id)}
                    onToggleSelect={handleToggleSelect}
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
