"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format"
import { EventPicker, type EventOption } from "@/modules/projects/ui/event-picker"
import { taskDueState } from "@/modules/tasks/task-due-state"
import { dueStateTextClass } from "@/modules/tasks/ui/due-state-class"
import { HighPriorityFlag } from "@/modules/tasks/ui/high-priority-flag"
import { useToday } from "@/modules/tasks/ui/use-today"
import { TaskFilterStrip, type TaskMemberOption } from "@/modules/tasks/ui/task-filter-strip"
import { AssigneePicker } from "@/modules/tasks/ui/assignee-picker"
import {
  parseTaskFilters,
  applyTaskFilters,
  hasActiveFilters,
  sortOpenTasks,
  sortCompletedTasks,
} from "@/modules/tasks/task-filter"
import type { TaskPriority } from "@/modules/tasks/types"
import {
  createTask,
  markTaskDone,
  markTaskNotDone,
  updateTask,
  deleteTask,
  associateTaskEvent,
  removeTaskEvent,
} from "@/modules/tasks/actions"

/**
 * Contact detail → Tasks tab (top-level, per design-system §7). A HubSpot-style
 * filter strip (search + 5 dropdowns + pills, URL-persisted — see
 * TaskFilterStrip) over the contact's tasks. With no filters active the list
 * splits into a collapsible Open + Completed (Completed collapsed by default);
 * with any filter active it flattens to a single due-date-ordered list
 * (Mike-locked 2026-06-20, decision #10).
 *
 * Filtering is client-side: the full task set is already loaded as props, so
 * `applyTaskFilters` runs in-memory and the URL is the only state. Color states
 * + the High-priority flag (prior commit) are preserved on every row.
 *
 * Plain-English throughout: "Open", "Completed", "Create a task", "Due",
 * "General" (= not linked to any event). No IDs or jargon surfaced.
 */

export interface ContactTaskItem {
  id: string
  title: string
  /** YYYY-MM-DD or null. */
  dueDate: string | null
  status: string
  /** ISO timestamp or null. */
  completedAt: string | null
  /** Linked event (project) id + name, or null when not event-linked. */
  projectId: string | null
  eventName: string | null
  /** "low" | "medium" | "high" | null (no priority). */
  priority: string | null
  /** Org member id this task is assigned to, or null (unassigned). */
  assigneeUserId: string | null
}

// Priority picker — "No priority" + Low / Medium / High. Empty string is the
// "No priority" sentinel; the caller maps it to null.
const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]

// The select holds a plain string; coerce the "No priority" sentinel ("") and
// any unexpected value to null, otherwise narrow to the TaskPriority union.
function toPriorityInput(v: string): TaskPriority | null {
  return v === "low" || v === "medium" || v === "high" ? v : null
}

function PriorityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-[var(--color-muted-foreground)]">
      Priority
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        className="ml-2 inline-block h-8 w-auto rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm"
        data-testid="contact-task-priority"
      >
        {PRIORITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function ContactTasksPane({
  contactId,
  tasks,
  eventOptions,
  members,
  currentUserId,
}: {
  contactId: string
  tasks: ContactTaskItem[]
  /** All events in the org for the Add/Edit pickers. */
  eventOptions: EventOption[]
  /** Org members for the "Assigned to" filter + assignee pickers (name + avatar). */
  members: TaskMemberOption[]
  /** The viewing user — new tasks auto-assign to them (decision #1). */
  currentUserId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const today = useToday()
  const [, startTransition] = useTransition()
  const [adding, setAdding] = useState(false)

  const filters = parseTaskFilters(searchParams)
  const anyActive = hasActiveFilters(filters)

  // Filters panel opens automatically when a shared URL already carries filters.
  const [filtersOpen, setFiltersOpen] = useState(() => anyActive)
  // Completed is collapsed by default (decision #10); Open starts expanded.
  const [openExpanded, setOpenExpanded] = useState(true)
  const [completedExpanded, setCompletedExpanded] = useState(false)

  function refresh() {
    startTransition(() => {
      router.refresh()
    })
  }

  // The Event filter lists only the events THIS contact's tasks touch.
  const eventFilterOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of tasks) {
      if (t.projectId && t.eventName && !seen.has(t.projectId)) {
        seen.set(t.projectId, t.eventName)
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }))
  }, [tasks])

  // Client-side filtering — all tasks are already loaded as props.
  const matched = useMemo(
    () => applyTaskFilters(tasks, filters, today ?? ""),
    [tasks, filters, today],
  )
  const openTasks = useMemo(
    () =>
      sortOpenTasks(
        matched.filter((t) => t.status !== "done"),
        filters.sortByPriority,
      ),
    [matched, filters.sortByPriority],
  )
  const completedTasks = useMemo(
    () =>
      sortCompletedTasks(
        matched.filter((t) => t.status === "done"),
        filters.sortByPriority,
      ),
    [matched, filters.sortByPriority],
  )
  // Flat list (any filter active): sort by priority when the toggle is on,
  // else due date — the toggle works consistently in both views (Mike, option
  // B, 2026-06-20).
  const flatList = useMemo(
    () => sortOpenTasks(matched, filters.sortByPriority),
    [matched, filters.sortByPriority],
  )

  const createButton = (
    <Button
      type="button"
      size="sm"
      onClick={() => {
        setAdding((v) => !v)
      }}
      data-testid="contact-tasks-add"
    >
      {adding ? "Close" : "Create a task"}
    </Button>
  )
  // "Collapse all" only applies to the sectioned (unfiltered) view.
  const collapseAll = anyActive ? undefined : (
    <button
      type="button"
      onClick={() => {
        setOpenExpanded(false)
        setCompletedExpanded(false)
      }}
      className="shrink-0 text-xs text-[var(--color-muted-foreground)] hover:underline"
      data-testid="contact-tasks-collapse-all"
    >
      Collapse all
    </button>
  )

  return (
    <div className="space-y-4" data-testid="contact-tasks-pane">
      <TaskFilterStrip
        eventOptions={eventFilterOptions}
        memberOptions={members}
        today={today}
        createSlot={createButton}
        collapseAllSlot={collapseAll}
        filtersOpen={filtersOpen}
        onToggleFilters={() => {
          setFiltersOpen((v) => !v)
        }}
      />

      {adding && (
        <AddTaskForm
          contactId={contactId}
          eventOptions={eventOptions}
          members={members}
          currentUserId={currentUserId}
          onSaved={() => {
            setAdding(false)
            refresh()
          }}
          onCancel={() => {
            setAdding(false)
          }}
        />
      )}

      {anyActive ? (
        <section className="space-y-2" data-testid="contact-tasks-flat">
          {flatList.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-muted-foreground)]">
              No tasks match these filters.
            </p>
          ) : (
            <TaskList
              tasks={flatList}
              eventOptions={eventOptions}
              members={members}
              onChanged={refresh}
            />
          )}
        </section>
      ) : (
        <>
          <CollapsibleSection
            title="Open"
            count={openTasks.length}
            expanded={openExpanded}
            onToggle={() => {
              setOpenExpanded((v) => !v)
            }}
            testId="contact-tasks-open"
          >
            {openTasks.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                No open tasks. Use “Create a task” to add one.
              </p>
            ) : (
              <TaskList
                tasks={openTasks}
                eventOptions={eventOptions}
                members={members}
                onChanged={refresh}
              />
            )}
          </CollapsibleSection>

          {completedTasks.length > 0 && (
            <CollapsibleSection
              title="Completed"
              count={completedTasks.length}
              expanded={completedExpanded}
              onToggle={() => {
                setCompletedExpanded((v) => !v)
              }}
              testId="contact-tasks-completed"
              className="border-t border-[var(--color-border)] pt-4"
            >
              <TaskList
                tasks={completedTasks}
                eventOptions={eventOptions}
                members={members}
                onChanged={refresh}
              />
            </CollapsibleSection>
          )}
        </>
      )}
    </div>
  )
}

function CollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  testId,
  className,
  children,
}: {
  title: string
  count: number
  expanded: boolean
  onToggle: () => void
  testId: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("space-y-2", className)} data-testid={testId}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center gap-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        data-testid={`${testId}-toggle`}
      >
        <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
        {title} ({count})
      </button>
      {expanded && children}
    </section>
  )
}

function TaskList({
  tasks,
  eventOptions,
  members,
  onChanged,
}: {
  tasks: ContactTaskItem[]
  eventOptions: EventOption[]
  members: TaskMemberOption[]
  onChanged: () => void
}) {
  return (
    <ul className="space-y-1">
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          eventOptions={eventOptions}
          members={members}
          onChanged={onChanged}
        />
      ))}
    </ul>
  )
}

function AddTaskForm({
  contactId,
  eventOptions,
  members,
  currentUserId,
  onSaved,
  onCancel,
}: {
  contactId: string
  eventOptions: EventOption[]
  members: TaskMemberOption[]
  currentUserId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [priority, setPriority] = useState("")
  const [projectId, setProjectId] = useState<string | null>(null)
  // New tasks auto-assign to the creator (decision #1); overridable below.
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(currentUserId)
  const [options, setOptions] = useState<EventOption[]>(eventOptions)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onCreate() {
    if (!title.trim()) {
      setError("Add a task title.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await createTask({
      contactId,
      projectId,
      title: title.trim(),
      dueDate: dueDate || undefined,
      priority: toPriorityInput(priority),
      assigneeUserId,
    })
    setSaving(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    onSaved()
  }

  return (
    <div
      className="space-y-2 rounded-md border border-[var(--color-border)] p-3"
      data-testid="contact-tasks-add-form"
    >
      <Input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
        }}
        placeholder="What needs doing?"
        className="h-8 text-sm"
        data-testid="contact-tasks-add-title"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--color-muted-foreground)]">
          Due
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value)
            }}
            className="ml-2 inline-block h-8 w-auto text-sm"
          />
        </label>
        <PriorityPicker value={priority} onChange={setPriority} />
        <div className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
          <span>Assigned to</span>
          <AssigneePicker
            members={members}
            value={assigneeUserId}
            onChange={setAssigneeUserId}
            variant="full"
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <EventPicker
            options={options}
            value={projectId}
            onChange={setProjectId}
            onEventCreated={(ev) => {
              setOptions((prev) => [...prev, ev])
            }}
          />
        </div>
      </div>
      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void onCreate()} disabled={saving}>
          {saving ? "Adding…" : "Add task"}
        </Button>
      </div>
    </div>
  )
}

function TaskRow({
  task,
  eventOptions,
  members,
  onChanged,
}: {
  task: ContactTaskItem
  eventOptions: EventOption[]
  members: TaskMemberOption[]
  onChanged: () => void
}) {
  const done = task.status === "done"
  const today = useToday()
  const dueState = taskDueState(task.dueDate, task.status, today)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function toggleDone() {
    setBusy(true)
    if (done) await markTaskNotDone({ id: task.id })
    else await markTaskDone({ id: task.id })
    setBusy(false)
    onChanged()
  }

  // Quick-reassign from the row avatar — no edit mode (decision #4). Allowed on
  // any row, including completed (decision #3 / Mike 2026-06-20).
  async function reassign(userId: string | null) {
    setBusy(true)
    await updateTask({ id: task.id, assigneeUserId: userId })
    setBusy(false)
    onChanged()
  }

  async function doDelete() {
    setBusy(true)
    await deleteTask({ id: task.id })
    setBusy(false)
    setDeleteOpen(false)
    onChanged()
  }

  if (editing) {
    return (
      <li>
        <EditTaskRow
          task={task}
          eventOptions={eventOptions}
          members={members}
          onDone={() => {
            setEditing(false)
            onChanged()
          }}
          onCancel={() => {
            setEditing(false)
          }}
        />
      </li>
    )
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--color-accent)]/30",
        done && "opacity-50",
      )}
      data-testid="contact-task-row"
    >
      <input
        type="checkbox"
        checked={done}
        disabled={busy}
        onChange={() => void toggleDone()}
        aria-label={done ? "Mark task open" : "Mark task complete"}
        className="size-4 shrink-0"
        data-testid="contact-task-checkbox"
      />
      <span className={cn("flex flex-1 items-center gap-1.5 text-sm", done && "line-through")}>
        <HighPriorityFlag priority={task.priority} />
        <span className={cn(dueStateTextClass(dueState))}>{task.title}</span>
      </span>
      {task.eventName && (
        <span className="shrink-0 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[10px] text-[var(--color-muted-foreground)]">
          {task.eventName}
        </span>
      )}
      <AssigneePicker
        members={members}
        value={task.assigneeUserId}
        onChange={(userId) => void reassign(userId)}
        variant="avatar"
      />
      {done && task.completedAt ? (
        <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)] tabular-nums">
          Completed {formatDate(task.completedAt)}
        </span>
      ) : task.dueDate ? (
        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums",
            dueStateTextClass(dueState) || "text-[var(--color-muted-foreground)]",
          )}
        >
          Due {formatDate(task.dueDate)}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          setEditing(true)
        }}
        className="shrink-0 text-[11px] text-[var(--color-muted-foreground)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-foreground)]"
        data-testid="contact-task-edit"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => {
          setDeleteOpen(true)
        }}
        className="shrink-0 text-[11px] text-[var(--color-destructive)] opacity-0 transition group-hover:opacity-100"
        data-testid="contact-task-delete"
      >
        Delete
      </button>
      <ConfirmModal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false)
        }}
        onConfirm={() => void doDelete()}
        title="Delete this task?"
        body="The task will be removed from this contact."
        confirmLabel="Delete"
        destructive
        submitting={busy}
      />
    </li>
  )
}

function EditTaskRow({
  task,
  eventOptions,
  members,
  onDone,
  onCancel,
}: {
  task: ContactTaskItem
  eventOptions: EventOption[]
  members: TaskMemberOption[]
  onDone: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(task.title)
  const [dueDate, setDueDate] = useState(task.dueDate ?? "")
  const [priority, setPriority] = useState(task.priority ?? "")
  const [projectId, setProjectId] = useState<string | null>(task.projectId)
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(task.assigneeUserId)
  const [options, setOptions] = useState<EventOption[]>(eventOptions)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSave() {
    if (!title.trim()) {
      setError("Add a task title.")
      return
    }
    setSaving(true)
    setError(null)
    // Title / due date / priority / assignee.
    const upd = await updateTask({
      id: task.id,
      title: title.trim(),
      dueDate: dueDate || "",
      priority: toPriorityInput(priority),
      assigneeUserId,
    })
    if (upd.serverError) {
      setSaving(false)
      setError(upd.serverError)
      return
    }
    // Event link changed? Associate or remove accordingly.
    if (projectId !== task.projectId) {
      const linkResult = projectId
        ? await associateTaskEvent({ id: task.id, projectId })
        : await removeTaskEvent({ id: task.id })
      if (linkResult.serverError) {
        setSaving(false)
        setError(linkResult.serverError)
        return
      }
    }
    setSaving(false)
    onDone()
  }

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
      <Input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
        }}
        className="h-8 text-sm"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--color-muted-foreground)]">
          Due
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value)
            }}
            className="ml-2 inline-block h-8 w-auto text-sm"
          />
        </label>
        <PriorityPicker value={priority} onChange={setPriority} />
        <div className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
          <span>Assigned to</span>
          <AssigneePicker
            members={members}
            value={assigneeUserId}
            onChange={setAssigneeUserId}
            variant="full"
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <EventPicker
            options={options}
            value={projectId}
            onChange={setProjectId}
            onEventCreated={(ev) => {
              setOptions((prev) => [...prev, ev])
            }}
          />
        </div>
      </div>
      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void onSave()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}
