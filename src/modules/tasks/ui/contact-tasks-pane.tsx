"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format"
import { EventPicker, type EventOption } from "@/modules/projects/ui/event-picker"
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
 * Contact detail → Tasks tab (top-level, per design-system §7). Shows the
 * contact's tasks split into Open and Completed, with event filter chips and
 * an inline event tag on each task. Add / complete / edit / delete inline.
 *
 * Plain-English throughout: "Open", "Completed", "Add task", "Due",
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
}

// Sentinels "all" / "general", or a projectId string (all are strings).
type ChipKey = string

export function ContactTasksPane({
  contactId,
  tasks,
  eventOptions,
}: {
  contactId: string
  tasks: ContactTaskItem[]
  /** All events in the org for the picker; the chips derive from `tasks`. */
  eventOptions: EventOption[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [chip, setChip] = useState<ChipKey>("all")
  const [adding, setAdding] = useState(false)

  function refresh() {
    startTransition(() => {
      router.refresh()
    })
  }

  // Event chips: one per distinct event present on this contact's tasks.
  const eventChips = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of tasks) {
      if (t.projectId && t.eventName && !seen.has(t.projectId)) {
        seen.set(t.projectId, t.eventName)
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }))
  }, [tasks])

  const filtered = useMemo(() => {
    if (chip === "all") return tasks
    if (chip === "general") return tasks.filter((t) => !t.projectId)
    return tasks.filter((t) => t.projectId === chip)
  }, [tasks, chip])

  const open = filtered.filter((t) => t.status !== "done")
  const completed = filtered.filter((t) => t.status === "done")

  return (
    <div className="space-y-4" data-testid="contact-tasks-pane">
      {/* Event filter chips */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <FilterChip
          label="All"
          active={chip === "all"}
          onClick={() => {
            setChip("all")
          }}
        />
        <FilterChip
          label="General"
          active={chip === "general"}
          onClick={() => {
            setChip("general")
          }}
        />
        {eventChips.map((ev) => (
          <FilterChip
            key={ev.id}
            label={ev.name}
            active={chip === ev.id}
            onClick={() => {
              setChip(ev.id)
            }}
          />
        ))}
        <div className="ml-auto">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setAdding((v) => !v)
            }}
            data-testid="contact-tasks-add"
          >
            {adding ? "Close" : "Add task"}
          </Button>
        </div>
      </div>

      {adding && (
        <AddTaskForm
          contactId={contactId}
          eventOptions={eventOptions}
          onSaved={() => {
            setAdding(false)
            refresh()
          }}
          onCancel={() => {
            setAdding(false)
          }}
        />
      )}

      {/* Open */}
      <section className="space-y-2" data-testid="contact-tasks-open">
        <h3 className="text-xs font-medium text-[var(--color-muted-foreground)]">
          Open ({open.length})
        </h3>
        {open.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-muted-foreground)]">
            No open tasks. Use “Add task” to create one.
          </p>
        ) : (
          <ul className="space-y-1">
            {open.map((t) => (
              <TaskRow key={t.id} task={t} eventOptions={eventOptions} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      {/* Completed — separated below Open */}
      {completed.length > 0 && (
        <section
          className="space-y-2 border-t border-[var(--color-border)] pt-4"
          data-testid="contact-tasks-completed"
        >
          <h3 className="text-xs font-medium text-[var(--color-muted-foreground)]">
            Completed ({completed.length})
          </h3>
          <ul className="space-y-1">
            {completed.map((t) => (
              <TaskRow key={t.id} task={t} eventOptions={eventOptions} onChanged={refresh} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function FilterChip({
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

function AddTaskForm({
  contactId,
  eventOptions,
  onSaved,
  onCancel,
}: {
  contactId: string
  eventOptions: EventOption[]
  onSaved: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [projectId, setProjectId] = useState<string | null>(null)
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
  onChanged,
}: {
  task: ContactTaskItem
  eventOptions: EventOption[]
  onChanged: () => void
}) {
  const done = task.status === "done"
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
      <span className={cn("flex-1 text-sm", done && "line-through")}>{task.title}</span>
      {task.eventName && (
        <span className="shrink-0 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[10px] text-[var(--color-muted-foreground)]">
          {task.eventName}
        </span>
      )}
      {done && task.completedAt ? (
        <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)] tabular-nums">
          Completed {formatDate(task.completedAt)}
        </span>
      ) : task.dueDate ? (
        <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)] tabular-nums">
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
  onDone,
  onCancel,
}: {
  task: ContactTaskItem
  eventOptions: EventOption[]
  onDone: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(task.title)
  const [dueDate, setDueDate] = useState(task.dueDate ?? "")
  const [projectId, setProjectId] = useState<string | null>(task.projectId)
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
    // Title / due date.
    const upd = await updateTask({
      id: task.id,
      title: title.trim(),
      dueDate: dueDate || "",
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
