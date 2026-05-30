"use client"

import { useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  FileText,
  MessageSquare,
  Phone,
  Sparkles,
  Video,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6c) — contact activity feed.
 *
 * Unified, filterable timeline of notes + calls + meetings + sms
 * messages + audit-derived events. The host loader feeds normalized
 * entries (already sorted DESC by timestamp).
 *
 * Polish #5 Fix 6 — each entry now renders as a bordered card with a
 * collapse chevron + type icon + "{Type} by {Author}" title + right-
 * aligned timestamp + multi-line body. Cards are the right surface
 * for activity entries per design-system §2 ("discrete actionable
 * items get cards").
 *
 * Polish #5 Fix 7b — replaced the pill filter strip with an HubSpot-
 * pattern underline sub-tab strip covering all 7 activity types
 * (Notes / Calls / Emails / Tasks / Meetings / SMS), so placeholder
 * categories surface their ship-target empty state when picked.
 */

export type ActivityEntryKind = "note" | "call" | "meeting" | "sms" | "audit"

export interface ActivityEntry {
  id: string
  kind: ActivityEntryKind
  timestamp: Date
  /** One-line summary (renders bold). */
  title: string
  /** Multi-line body shown indented under the title. Optional. */
  body?: string | null
  /** Who created the entry. Optional. */
  actor?: string | null
}

function timeAgo(t: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - t.getTime()) / 1000))
  if (seconds < 60) return `${String(seconds)}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${String(days)}d ago`
  return t.toLocaleDateString()
}

type FilterKey = "all" | "note" | "call" | "email" | "task" | "meeting" | "sms"

const FILTER_ORDER: FilterKey[] = ["all", "note", "call", "email", "task", "meeting", "sms"]
const FILTER_LABEL: Record<FilterKey, string> = {
  all: "All activities",
  note: "Notes",
  call: "Calls",
  email: "Emails",
  task: "Tasks",
  meeting: "Meetings",
  sms: "SMS",
}
// Filters that don't yet have backing data — placeholder empty state.
const PLACEHOLDER_FILTERS: Partial<Record<FilterKey, string>> = {
  email: "Email logging ships in Push 5+ once the integration lands.",
  task: "Tasks ship in Push 7. Once they exist they'll surface here.",
  sms: "SMS logging ships in Push 5+ once the provider integration lands.",
}

// Display title format: "{Type} by {Author}". Falls back to the
// loader's title when no actor is provided.
function entryTitleText(e: ActivityEntry): string {
  const kindLabel = (() => {
    switch (e.kind) {
      case "note":
        return "Note"
      case "call":
        return "Call"
      case "meeting":
        return "Meeting"
      case "sms":
        return "SMS"
      case "audit":
        return "Audit"
    }
  })()
  if (e.actor) return `${kindLabel} by ${e.actor}`
  return e.title || kindLabel
}

export function ContactActivityFeed({
  entries,
  className,
}: {
  entries: ActivityEntry[]
  className?: string
}) {
  const [filter, setFilter] = useState<FilterKey>("all")

  // Map FilterKey → entries. "email" / "task" / "sms" map to their
  // ActivityEntryKind when real entries arrive; for V1 we just
  // filter by matching kind.
  const visible =
    filter === "all"
      ? entries
      : filter === "note"
        ? entries.filter((e) => e.kind === "note")
        : filter === "call"
          ? entries.filter((e) => e.kind === "call")
          : filter === "meeting"
            ? entries.filter((e) => e.kind === "meeting")
            : filter === "sms"
              ? entries.filter((e) => e.kind === "sms")
              : [] // email + task — no backing data in V1

  const counts: Record<FilterKey, number> = {
    all: entries.length,
    note: entries.filter((e) => e.kind === "note").length,
    call: entries.filter((e) => e.kind === "call").length,
    email: 0,
    task: 0,
    meeting: entries.filter((e) => e.kind === "meeting").length,
    sms: entries.filter((e) => e.kind === "sms").length,
  }

  return (
    <div className={cn("space-y-3", className)} data-testid="contact-activity-feed">
      {/* Polish #5 Fix 7b — HubSpot underline sub-tab strip. Scrolls
          horizontally on narrow viewports (mobile). */}
      <div
        role="tablist"
        aria-label="Activity filters"
        className="flex gap-3 overflow-x-auto border-b border-[var(--color-border)] whitespace-nowrap"
      >
        {FILTER_ORDER.map((key) => (
          <FilterTab
            key={key}
            label={FILTER_LABEL[key]}
            count={counts[key]}
            active={filter === key}
            onClick={() => {
              setFilter(key)
            }}
            testId={`activity-filter-${key}`}
          />
        ))}
      </div>

      {PLACEHOLDER_FILTERS[filter] && visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
          {PLACEHOLDER_FILTERS[filter]}
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
          {entries.length === 0
            ? "No activity yet — use the Add note / Log call buttons above to start the feed."
            : `No ${FILTER_LABEL[filter].toLowerCase()} entries.`}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((e) => (
            <li key={e.id}>
              <ActivityCard entry={e} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilterTab({
  label,
  count,
  active,
  onClick,
  testId,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "shrink-0 border-b-2 px-1 pb-2 text-sm transition-colors",
        active
          ? "border-[var(--color-primary)] font-medium text-[var(--color-primary)]"
          : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
      )}
    >
      {label}{" "}
      <span className="text-xs text-[var(--color-muted-foreground)]">({String(count)})</span>
    </button>
  )
}

function ActivityCard({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(true)
  const hasBody = !!entry.body && entry.body.length > 0
  return (
    <article
      className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3"
      data-testid={`activity-entry-${entry.kind}`}
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o)
          }}
          aria-expanded={open}
          aria-label={open ? "Collapse entry" : "Expand entry"}
          className="inline-flex size-5 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
        >
          {open ? (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          )}
        </button>
        <span className="shrink-0">{kindIcon(entry.kind)}</span>
        <h3 className="flex-1 truncate text-sm font-medium">{entryTitleText(entry)}</h3>
        <time className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">
          {timeAgo(entry.timestamp)}
        </time>
      </header>
      {open && hasBody && (
        <p className="pl-7 text-sm whitespace-pre-wrap text-[var(--color-muted-foreground)]">
          {entry.body}
        </p>
      )}
    </article>
  )
}

function kindIcon(kind: ActivityEntryKind) {
  const cls = "size-4 text-[var(--color-muted-foreground)]"
  switch (kind) {
    case "note":
      return <FileText className={cls} aria-hidden="true" />
    case "call":
      return <Phone className={cls} aria-hidden="true" />
    case "meeting":
      return <Video className={cls} aria-hidden="true" />
    case "sms":
      return <MessageSquare className={cls} aria-hidden="true" />
    case "audit":
      return <Sparkles className={cls} aria-hidden="true" />
  }
}
