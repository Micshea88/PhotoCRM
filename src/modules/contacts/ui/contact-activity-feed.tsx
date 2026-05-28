"use client"

import { useState } from "react"
import { FileText, Phone, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Push 3 (C6c) — contact activity feed.
 *
 * Unified, filterable timeline of notes + calls + meetings + sms
 * messages + audit-derived events. The host loader feeds normalized
 * entries (already sorted DESC by timestamp). This component renders
 * + offers a filter-chip row to narrow by entry type.
 *
 * Empty state surfaces the V1 capture affordances — the user hits
 * the "Add note" / "Log call" buttons in the action row above and
 * the entry shows up here.
 *
 * Future additions (events / sms / email) plug into the same
 * `ActivityEntry` shape — no schema change for the feed itself.
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

const KIND_LABEL: Record<ActivityEntryKind, string> = {
  note: "Notes",
  call: "Calls",
  meeting: "Meetings",
  sms: "SMS",
  audit: "Audit",
}

export function ContactActivityFeed({
  entries,
  className,
}: {
  entries: ActivityEntry[]
  className?: string
}) {
  const allKinds = Object.keys(KIND_LABEL) as ActivityEntryKind[]
  const presentKinds = new Set(entries.map((e) => e.kind))
  const [filter, setFilter] = useState<ActivityEntryKind | "all">("all")

  const visible = filter === "all" ? entries : entries.filter((e) => e.kind === filter)

  return (
    <div className={cn("space-y-3", className)} data-testid="contact-activity-feed">
      <div className="flex flex-wrap gap-1">
        <FilterChip
          active={filter === "all"}
          onClick={() => {
            setFilter("all")
          }}
        >
          All ({String(entries.length)})
        </FilterChip>
        {allKinds
          .filter((k) => presentKinds.has(k))
          .map((k) => (
            <FilterChip
              key={k}
              active={filter === k}
              onClick={() => {
                setFilter(k)
              }}
            >
              {KIND_LABEL[k]} ({String(entries.filter((e) => e.kind === k).length)})
            </FilterChip>
          ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
          {entries.length === 0
            ? "No activity yet — use the Add note / Log call buttons above to start the feed."
            : `No ${KIND_LABEL[filter as ActivityEntryKind].toLowerCase()} entries.`}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((e) => (
            <li key={e.id} className="flex gap-3">
              <div className="mt-0.5 shrink-0">{kindIcon(e.kind)}</div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{e.title}</span>
                  <span className="text-[11px] text-[var(--color-muted-foreground)]">
                    {timeAgo(e.timestamp)}
                  </span>
                </div>
                {e.body && (
                  <p className="text-sm whitespace-pre-wrap text-[var(--color-muted-foreground)]">
                    {e.body}
                  </p>
                )}
                {e.actor && (
                  <p className="text-[11px] text-[var(--color-muted-foreground)]/80">
                    by {e.actor}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 font-medium text-[var(--color-primary)]"
          : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40",
      )}
    >
      {children}
    </button>
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
      return <FileText className={cls} aria-hidden="true" />
    case "sms":
      return <FileText className={cls} aria-hidden="true" />
    case "audit":
      return <Sparkles className={cls} aria-hidden="true" />
  }
}
