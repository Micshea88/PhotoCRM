"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  FileText,
  Filter as FilterIcon,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  Send,
  Sparkles,
  Video,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import { Input } from "@/components/ui/input"
import { Popover } from "@/components/ui/popover"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { cn } from "@/lib/utils"
import { openDialer } from "@/lib/open-dialer"
import { updateContactNote, deleteContactNote } from "@/modules/contacts/actions"
import { updateCall, deleteCall } from "@/modules/calls/actions"
import { updateMeeting, deleteMeeting } from "@/modules/meetings/actions"
import { updateSms, deleteSms } from "@/modules/sms-messages/actions"
import { updateEmail, deleteEmail } from "@/modules/email-log/actions"
import { NoPhoneProviderPicker } from "@/modules/integrations/ui/no-phone-provider-picker"
import {
  CallLogComposer,
  CreateEmailPopout,
  EmailLogComposer,
  MeetingLogComposer,
  NoteComposer,
  ScheduleMeetingPopout,
  SmsLogComposer,
} from "./activity-composers"

/**
 * P-activities — contact Activities tab.
 *
 * Replaces polish #5 Fix 6's read-only feed + Fix 7b's 7-tab strip
 * with the approved interactive layout:
 *   - Per-sub-tab toolbar (search + collapse-all + filters + per-type
 *     create/log buttons)
 *   - Inline composers above the feed (replaces modal-only logging)
 *   - Working Filters dropdown (Date range + Assigned to)
 *   - Pencil-only edit on every entry (clicking text does nothing;
 *     only the pencil enters edit mode — Mike was explicit). Edit
 *     uses an underlined inline textarea per design system §1.
 *   - Connect-gate pop-outs for the V1.5 integrations (email,
 *     meeting, call) — disabled "Connect" button with ship-target
 *     tooltip. Wire-up lands when the integrations ship.
 *
 * Schema realities (carried over from previous polish builds):
 *   - notes, calls, meetings, sms_messages are per-type tables.
 *   - Email does NOT have a dedicated table yet — Log email lands as
 *     a contact_note with a Subject prefix.
 *   - Tasks are project-scoped (tasks.projectId NOT NULL); contact-
 *     scoped tasks ship with Push 7. Tasks sub-tab keeps the existing
 *     ship-target empty state; the call composer's "Create follow-up
 *     task" toggle ships disabled until P7 lands.
 *
 * Every CREATE / EDIT / DELETE action busts the contact's AI cache
 * (Fix 8 contract) so the next page render auto-regens with the new
 * activity (now works — Anthropic key is set).
 */

export type ActivityEntryKind = "note" | "call" | "meeting" | "sms" | "email" | "audit"

export interface ActivityEntry {
  id: string
  kind: ActivityEntryKind
  timestamp: Date
  title: string
  body?: string | null
  /** P-email-log — email subject line. Surfaced as the bold primary
   *  line above the body per the approved mockup. Only set for
   *  `kind === "email"`. */
  subject?: string | null
  actor?: string | null
  /** P-activities — passed through by the loader so the pencil-edit
   *  primitive can call the right update/delete action. */
  actorUserId?: string | null
  /** Backing-table id (the loader prefixes the entry id with
   *  "note-" / "call-" etc.; the raw id without the prefix is what
   *  update/delete actions expect). */
  rawId?: string
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
const PLACEHOLDER_FILTERS: Partial<Record<FilterKey, string>> = {
  // P-email-log shipped — Email is a real filter now; only Tasks
  // remains as a ship-target placeholder.
  task: "Tasks ship in Push 7. Once they exist they'll surface here.",
}

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
      case "email":
        return "Email"
      case "audit":
        return "Audit"
    }
  })()
  if (e.actor) {
    // P-email-log mockup uses " · " for email headers; the other kinds
    // keep the existing " by " idiom.
    const sep = e.kind === "email" ? " · " : " by "
    return `${kindLabel}${sep}${e.actor}`
  }
  return e.title || kindLabel
}

type DatePreset = "all" | "today" | "week" | "month" | "custom"

interface FeedFilters {
  date: DatePreset
  customFrom: string
  customTo: string
  assignedTo: string | null
  search: string
}

const DEFAULT_FILTERS: FeedFilters = {
  date: "all",
  customFrom: "",
  customTo: "",
  assignedTo: null,
  search: "",
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function dateRangeFromPreset(f: FeedFilters): { from: Date | null; to: Date | null } {
  const now = new Date()
  switch (f.date) {
    case "today": {
      const from = startOfDay(now)
      return { from, to: null }
    }
    case "week": {
      const from = new Date(now)
      from.setDate(from.getDate() - 7)
      return { from, to: null }
    }
    case "month": {
      const from = new Date(now)
      from.setMonth(from.getMonth() - 1)
      return { from, to: null }
    }
    case "custom":
      return {
        from: f.customFrom ? new Date(f.customFrom) : null,
        to: f.customTo ? new Date(f.customTo) : null,
      }
    case "all":
    default:
      return { from: null, to: null }
  }
}

function applyFilters(entries: ActivityEntry[], f: FeedFilters): ActivityEntry[] {
  const { from, to } = dateRangeFromPreset(f)
  const q = f.search.trim().toLowerCase()
  return entries.filter((e) => {
    if (from && e.timestamp < from) return false
    if (to && e.timestamp > to) return false
    if (f.assignedTo && e.actorUserId !== f.assignedTo) return false
    if (q) {
      const hay = `${e.title} ${e.body ?? ""} ${e.actor ?? ""}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

interface AssigneeOption {
  id: string
  label: string
}

export function ContactActivityFeed({
  contactId,
  entries,
  assigneeOptions = [],
  className,
  hasConnectedPhoneProvider = false,
  primaryPhone = null,
}: {
  contactId: string
  entries: ActivityEntry[]
  assigneeOptions?: AssigneeOption[]
  className?: string
  /** Server-side boolean from the contact page. Drives the "Make a
   *  call" button's branch between picker (no provider) and the
   *  connected-path placeholder. */
  hasConnectedPhoneProvider?: boolean
  /** Threaded through to NoPhoneProviderPicker so picking tel: from
   *  the picker fires tel:${primaryPhone} immediately. */
  primaryPhone?: string | null
}) {
  const [activeTab, setActiveTab] = useState<FilterKey>("all")
  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FILTERS)
  // Backlog Item 1c — All-tab Type chips filter IN PLACE (don't jump
  // to the type sub-tab). Local state on the All tab; tab-scoped so
  // it resets when the user switches sub-tabs.
  const [allTabTypeFilter, setAllTabTypeFilter] = useState<ActivityEntryKind | null>(null)
  const [collapseAll, setCollapseAll] = useState(false)
  const [composer, setComposer] = useState<null | "note" | "call" | "email" | "meeting" | "sms">(
    null,
  )
  // "call" removed from the popout union — the "Make a call" button
  // now opens NoPhoneProviderPicker (when not connected) or fires the
  // connected-path placeholder (when connected).
  const [popout, setPopout] = useState<null | "email" | "meeting">(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const counts = useMemo(() => {
    return {
      all: entries.length,
      note: entries.filter((e) => e.kind === "note").length,
      call: entries.filter((e) => e.kind === "call").length,
      email: entries.filter((e) => e.kind === "email").length,
      task: 0,
      meeting: entries.filter((e) => e.kind === "meeting").length,
      sms: entries.filter((e) => e.kind === "sms").length,
    }
  }, [entries])

  const visible = useMemo(() => {
    const byTab =
      activeTab === "all"
        ? // Item 1c — All-tab inline Type chips filter in place.
          allTabTypeFilter
          ? entries.filter((e) => e.kind === allTabTypeFilter)
          : entries
        : activeTab === "note"
          ? entries.filter((e) => e.kind === "note")
          : activeTab === "call"
            ? entries.filter((e) => e.kind === "call")
            : activeTab === "email"
              ? entries.filter((e) => e.kind === "email")
              : activeTab === "meeting"
                ? entries.filter((e) => e.kind === "meeting")
                : activeTab === "sms"
                  ? entries.filter((e) => e.kind === "sms")
                  : []
    return applyFilters(byTab, filters)
  }, [entries, activeTab, allTabTypeFilter, filters])

  // For "All activities" the filter strip mirrors the per-type
  // toolbar but also shows an inline Activity-type filter (since the
  // tab isn't tied to a type).
  return (
    <div className={cn("space-y-4", className)} data-testid="contact-activity-feed">
      {/* 7-tab underline strip — preserved from polish #5 Fix 7b. */}
      <div
        role="tablist"
        aria-label="Activity filters"
        className="flex gap-3 overflow-x-auto border-b border-[var(--color-border)] whitespace-nowrap"
      >
        {FILTER_ORDER.map((key) => (
          <SubFilterTab
            key={key}
            label={FILTER_LABEL[key]}
            count={counts[key]}
            active={activeTab === key}
            onClick={() => {
              setActiveTab(key)
              setFilters(DEFAULT_FILTERS)
              setAllTabTypeFilter(null)
              setComposer(null)
            }}
            testId={`activity-filter-${key}`}
          />
        ))}
      </div>

      {/* Toolbar — row 1: search + collapse all. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--color-muted-foreground)]"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={filters.search}
            onChange={(e) => {
              setFilters((p) => ({ ...p, search: e.target.value }))
            }}
            placeholder={`Search ${activeTab === "all" ? "activity" : FILTER_LABEL[activeTab].toLowerCase()}…`}
            className="h-8 pl-7 text-xs"
            data-testid="activity-search"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setCollapseAll((v) => !v)
          }}
          data-testid="activity-collapse-all"
        >
          {collapseAll ? "Expand all" : "Collapse all"}
        </Button>
      </div>

      {/* Toolbar — row 2: filters + per-type create/log buttons. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Backlog Item 1d — Popover owns its own open/close state.
            The earlier double-toggle (setFiltersOpen + toggle) made
            one click cancel itself out. Removed the redundant state
            so one click = one toggle. */}
        <Popover
          align="start"
          trigger={({ toggle }) => (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggle}
              data-testid="activity-filters-button"
            >
              <FilterIcon className="mr-1 size-3.5" aria-hidden="true" /> Filters
            </Button>
          )}
        >
          <FiltersPanel
            filters={filters}
            onChange={(next) => {
              setFilters(next)
            }}
            assigneeOptions={assigneeOptions}
          />
        </Popover>

        {/* Per-tab create/log buttons. */}
        {activeTab === "all" && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setComposer("note")
            }}
            data-testid="activity-create-note"
          >
            <Plus className="mr-1 size-3.5" aria-hidden="true" /> Create a note
          </Button>
        )}
        {activeTab === "note" && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setComposer("note")
            }}
          >
            <Plus className="mr-1 size-3.5" aria-hidden="true" /> Create a note
          </Button>
        )}
        {activeTab === "call" && (
          <>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setComposer("call")
              }}
              data-testid="activity-log-call"
            >
              <Phone className="mr-1 size-3.5" aria-hidden="true" /> Log a call
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (hasConnectedPhoneProvider) {
                  if (primaryPhone) {
                    openDialer({ phoneNumber: primaryPhone, contactId })
                  }
                  return
                }
                setPickerOpen(true)
              }}
              data-testid="activity-make-call"
            >
              Make a call
            </Button>
          </>
        )}
        {activeTab === "email" && (
          <>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setComposer("email")
              }}
            >
              <Mail className="mr-1 size-3.5" aria-hidden="true" /> Log an email
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPopout("email")
              }}
              data-testid="activity-create-email"
            >
              <Send className="mr-1 size-3.5" aria-hidden="true" /> Create an email
            </Button>
          </>
        )}
        {activeTab === "task" && (
          <Button
            type="button"
            size="sm"
            disabled
            title="Contact-scoped tasks ship in Push 7."
            data-testid="activity-create-task"
          >
            <Plus className="mr-1 size-3.5" aria-hidden="true" /> Create a task
          </Button>
        )}
        {activeTab === "meeting" && (
          <>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setComposer("meeting")
              }}
              data-testid="activity-log-meeting"
            >
              <Calendar className="mr-1 size-3.5" aria-hidden="true" /> Log a meeting
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPopout("meeting")
              }}
              data-testid="activity-schedule-meeting"
            >
              Schedule a meeting
            </Button>
          </>
        )}
        {activeTab === "sms" && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setComposer("sms")
            }}
            data-testid="activity-log-sms"
          >
            <MessageSquare className="mr-1 size-3.5" aria-hidden="true" /> Log an SMS
          </Button>
        )}
      </div>

      {/* Backlog Item 1c — All-activities tab inline Type chips
          FILTER IN PLACE; they do NOT change tabs. Click a chip to
          narrow to that type; click again (or click "All") to clear. */}
      {activeTab === "all" && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-[var(--color-muted-foreground)]">Type:</span>
          <TypeChip
            label="All"
            active={allTabTypeFilter === null}
            onClick={() => {
              setAllTabTypeFilter(null)
            }}
          />
          {/* Chip order mirrors the sub-tab FILTER_ORDER so the
              All-activities Type filter and the sub-tab strip stay
              visually aligned. Tasks is excluded — still a Push 7
              ship-target placeholder, not a real kind yet. */}
          {(["note", "call", "email", "meeting", "sms"] as const).map((k) => (
            <TypeChip
              key={k}
              label={FILTER_LABEL[k]}
              active={allTabTypeFilter === k}
              onClick={() => {
                setAllTabTypeFilter((prev) => (prev === k ? null : k))
              }}
            />
          ))}
        </div>
      )}

      {/* Inline composer slot — above the feed. */}
      {composer === "note" && (
        <NoteComposer
          contactId={contactId}
          onSaved={() => {
            setComposer(null)
          }}
          onCancel={() => {
            setComposer(null)
          }}
        />
      )}
      {composer === "call" && (
        <CallLogComposer
          contactId={contactId}
          onSaved={() => {
            setComposer(null)
          }}
          onCancel={() => {
            setComposer(null)
          }}
        />
      )}
      {composer === "email" && (
        <EmailLogComposer
          contactId={contactId}
          onSaved={() => {
            setComposer(null)
          }}
          onCancel={() => {
            setComposer(null)
          }}
        />
      )}
      {composer === "meeting" && (
        <MeetingLogComposer
          contactId={contactId}
          onSaved={() => {
            setComposer(null)
          }}
          onCancel={() => {
            setComposer(null)
          }}
        />
      )}
      {composer === "sms" && (
        <SmsLogComposer
          contactId={contactId}
          onSaved={() => {
            setComposer(null)
          }}
          onCancel={() => {
            setComposer(null)
          }}
        />
      )}

      {/* Empty / placeholder states. */}
      {PLACEHOLDER_FILTERS[activeTab] && visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
          {PLACEHOLDER_FILTERS[activeTab]}
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
          {entries.length === 0
            ? "No activity yet — use the create/log buttons above to start the feed."
            : `No ${FILTER_LABEL[activeTab].toLowerCase()} entries match the current filters.`}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((e) => (
            <li key={e.id}>
              <ActivityCard entry={e} collapsedAll={collapseAll} />
            </li>
          ))}
        </ul>
      )}

      <CreateEmailPopout
        open={popout === "email"}
        onClose={() => {
          setPopout(null)
        }}
      />
      <ScheduleMeetingPopout
        open={popout === "meeting"}
        onClose={() => {
          setPopout(null)
        }}
      />
      <NoPhoneProviderPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false)
        }}
        primaryPhone={primaryPhone}
      />
    </div>
  )
}

function SubFilterTab({
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

function TypeChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px]",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
          : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40",
      )}
    >
      {label}
    </button>
  )
}

function FiltersPanel({
  filters,
  onChange,
  assigneeOptions,
}: {
  filters: FeedFilters
  onChange: (next: FeedFilters) => void
  assigneeOptions: AssigneeOption[]
}) {
  return (
    <div className="space-y-3 text-xs" data-testid="activity-filters-panel">
      <div className="space-y-1">
        <label className="font-medium text-[var(--color-muted-foreground)]">Date range</label>
        <select
          value={filters.date}
          onChange={(e) => {
            onChange({ ...filters, date: e.target.value as DatePreset })
          }}
          className="h-7 w-full rounded-md border border-[var(--color-border)] bg-transparent px-2 text-xs"
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="custom">Custom range</option>
        </select>
        {filters.date === "custom" && (
          <div className="mt-1 grid grid-cols-2 gap-1">
            <Input
              type="date"
              value={filters.customFrom}
              onChange={(e) => {
                onChange({ ...filters, customFrom: e.target.value })
              }}
              className="h-7 text-xs"
            />
            <Input
              type="date"
              value={filters.customTo}
              onChange={(e) => {
                onChange({ ...filters, customTo: e.target.value })
              }}
              className="h-7 text-xs"
            />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <label className="font-medium text-[var(--color-muted-foreground)]">Assigned to</label>
        <SearchableSelect
          items={assigneeOptions.map((o) => ({ value: o.id, label: o.label }))}
          value={filters.assignedTo}
          onChange={(v) => {
            onChange({ ...filters, assignedTo: v })
          }}
          placeholder="Any"
          allowClear
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          onChange({ ...DEFAULT_FILTERS, search: filters.search })
        }}
        data-testid="filters-clear"
      >
        Clear filters
      </Button>
    </div>
  )
}

/**
 * Backlog Item 1a/1b — activity-entry card with §1 pencil-only edit.
 *
 * Lifecycle (locked design system §1):
 *   1. Pencil icon (visible on hover) toggles edit mode. Clicking
 *      the body text does NOTHING.
 *   2. In edit mode the body becomes an underlined textarea (no box,
 *      no Save / Cancel buttons).
 *   3. Autosave on blur OR Enter (Shift+Enter inserts a newline).
 *   4. Esc reverts to the original body and exits edit.
 *   5. On server error, edit mode stays open + an inline message
 *      surfaces so the user can retry.
 *   6. Delete moved off the edit area into the entry's kebab/overflow
 *      menu. The delete action prompts via the shared ConfirmModal
 *      (Item 1b — replaces window.confirm).
 */
function ActivityCard({ entry, collapsedAll }: { entry: ActivityEntry; collapsedAll: boolean }) {
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.body ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const router = useRouter()
  const [, transition] = useTransition()
  const isOpen = collapsedAll ? false : open
  const hasBody = !!entry.body && entry.body.length > 0
  const canEdit = entry.kind !== "audit" && !!entry.rawId

  async function autosave() {
    if (!entry.rawId) return
    const next = draft.trim()
    // No-op when the value didn't change — avoids burning a Haiku
    // regen on a pure-blur with no edits.
    if (next === (entry.body ?? "").trim()) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    let serverError: string | undefined
    if (entry.kind === "note") {
      const r = await updateContactNote({ id: entry.rawId, body: next })
      serverError = r.serverError
    } else if (entry.kind === "call") {
      const r = await updateCall({ id: entry.rawId, notes: next })
      serverError = r.serverError
    } else if (entry.kind === "meeting") {
      const r = await updateMeeting({ id: entry.rawId, notes: next })
      serverError = r.serverError
    } else if (entry.kind === "sms") {
      const r = await updateSms({ id: entry.rawId, body: next })
      serverError = r.serverError
    } else if (entry.kind === "email") {
      const r = await updateEmail({ id: entry.rawId, body: next })
      serverError = r.serverError
    }
    setSaving(false)
    if (serverError) {
      setError(serverError)
      return
    }
    setEditing(false)
    transition(() => {
      router.refresh()
    })
  }

  async function doDelete() {
    if (!entry.rawId) return
    setDeleting(true)
    setDeleteError(null)
    let serverError: string | undefined
    if (entry.kind === "note") {
      const r = await deleteContactNote({ id: entry.rawId })
      serverError = r.serverError
    } else if (entry.kind === "call") {
      const r = await deleteCall({ id: entry.rawId })
      serverError = r.serverError
    } else if (entry.kind === "meeting") {
      const r = await deleteMeeting({ id: entry.rawId })
      serverError = r.serverError
    } else if (entry.kind === "sms") {
      const r = await deleteSms({ id: entry.rawId })
      serverError = r.serverError
    } else if (entry.kind === "email") {
      const r = await deleteEmail({ id: entry.rawId })
      serverError = r.serverError
    }
    setDeleting(false)
    if (serverError) {
      setDeleteError(serverError)
      return
    }
    setDeleteOpen(false)
    transition(() => {
      router.refresh()
    })
  }

  return (
    <article
      className="group space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3"
      data-testid={`activity-entry-${entry.kind}`}
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v)
          }}
          aria-expanded={isOpen}
          aria-label={isOpen ? "Collapse entry" : "Expand entry"}
          className="inline-flex size-5 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
        >
          {isOpen ? (
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
        {canEdit && !editing && (
          <>
            <button
              type="button"
              onClick={() => {
                setEditing(true)
                setDraft(entry.body ?? "")
                setError(null)
              }}
              aria-label="Edit entry"
              data-testid={`activity-edit-${entry.kind}`}
              className="inline-flex size-5 items-center justify-center rounded text-[var(--color-muted-foreground)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--color-accent)]/40"
            >
              <Pencil className="size-3" aria-hidden="true" />
            </button>
            <Popover
              align="end"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="More actions"
                  data-testid={`activity-kebab-${entry.kind}`}
                  className="inline-flex size-5 items-center justify-center rounded text-[var(--color-muted-foreground)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--color-accent)]/40"
                >
                  <MoreHorizontal className="size-3" aria-hidden="true" />
                </button>
              )}
            >
              <ul className="min-w-[140px] space-y-0.5 text-sm" role="menu">
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setDeleteOpen(true)
                    }}
                    data-testid={`activity-delete-${entry.kind}`}
                    className="block w-full rounded px-2 py-1.5 text-left text-red-700 hover:bg-red-500/10 dark:text-red-400"
                  >
                    Delete
                  </button>
                </li>
              </ul>
            </Popover>
          </>
        )}
      </header>
      {isOpen && !editing && (entry.kind === "email" ? !!entry.subject || hasBody : hasBody) && (
        <div className="space-y-1 pl-7">
          {/* P-email-log — Email cards render the subject as a bold
              primary line above the body. Other kinds stay body-only. */}
          {entry.kind === "email" && entry.subject && (
            <p
              className="text-sm font-medium text-[var(--color-foreground)]"
              data-testid={`activity-entry-${entry.kind}-subject`}
            >
              {entry.subject}
            </p>
          )}
          {hasBody && (
            <p className="text-sm whitespace-pre-wrap text-[var(--color-muted-foreground)]">
              {entry.body}
            </p>
          )}
        </div>
      )}
      {editing && (
        <div className="space-y-1 pl-7">
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                setEditing(false)
                setDraft(entry.body ?? "")
                setError(null)
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void autosave()
              }
            }}
            onBlur={() => {
              void autosave()
            }}
            rows={3}
            disabled={saving}
            autoFocus
            data-testid={`activity-edit-body-${entry.kind}`}
            className="w-full resize-y border-0 border-b border-[var(--color-primary)] bg-transparent p-1 text-sm focus:outline-none disabled:opacity-50"
          />
          {saving && <p className="text-[11px] text-[var(--color-muted-foreground)]">Saving…</p>}
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400" data-testid="activity-edit-error">
              {error}
            </p>
          )}
        </div>
      )}
      {/* Item 1b — ConfirmModal replaces window.confirm. */}
      <ConfirmModal
        open={deleteOpen}
        onClose={() => {
          if (!deleting) {
            setDeleteOpen(false)
            setDeleteError(null)
          }
        }}
        onConfirm={() => {
          void doDelete()
        }}
        title="Delete this entry?"
        body={
          deleteError ??
          "This activity entry will be soft-deleted. The AI summary will refresh on the next page render."
        }
        confirmLabel="Delete"
        destructive
        submitting={deleting}
      />
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
    case "email":
      return <Mail className={cls} aria-hidden="true" />
    case "meeting":
      return <Video className={cls} aria-hidden="true" />
    case "sms":
      return <MessageSquare className={cls} aria-hidden="true" />
    case "audit":
      return <Sparkles className={cls} aria-hidden="true" />
  }
}
