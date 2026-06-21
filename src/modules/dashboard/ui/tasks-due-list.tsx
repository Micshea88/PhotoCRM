"use client"

import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format"
import { Avatar } from "@/components/ui/avatar"
import { Tooltip } from "@/components/ui/tooltip"
import { taskDueState } from "@/modules/tasks/task-due-state"
import { dueStateTextClass } from "@/modules/tasks/ui/due-state-class"
import { HighPriorityFlag } from "@/modules/tasks/ui/high-priority-flag"
import { useToday } from "@/modules/tasks/ui/use-today"
import { resolveAssignee, type DashboardMember } from "@/modules/dashboard/ui/assignee-display"

export interface TasksDueListTask {
  id: string
  title: string
  dueDate: string | null
  status: string
  /** "low" | "medium" | "high" | null (no priority). */
  priority: string | null
  /** Org member id this task is assigned to, or null (unassigned). */
  assigneeUserId: string | null
}

export interface TasksDueListProps {
  /** Top N tasks to display (typically 3). */
  topTasks: TasksDueListTask[]
  /** Total count across the window (may exceed topTasks.length). */
  totalCount: number
  /** Org members for resolving assigneeUserId → avatar. */
  members: DashboardMember[]
}

/**
 * Renders the "Tasks due this week" card — a count headline plus the
 * top three by due date. Per LOC1, the empty state names a concrete
 * next step instead of just rendering a zero.
 *
 * Due-date color + High flag mirror the contact Tasks tab; the state is
 * computed against the viewer's browser-local today (see useToday).
 */
export function TasksDueList({ topTasks, totalCount, members }: TasksDueListProps) {
  const today = useToday()
  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-[var(--color-muted-foreground)]">
          Tasks due this week
        </h2>
        <span className="text-2xl font-semibold tabular-nums">{totalCount}</span>
      </div>
      {topTasks.length === 0 ? (
        <p className="text-sm">No tasks due this week. Add a task to get started.</p>
      ) : (
        <ul className="space-y-1">
          {topTasks.map((task) => {
            const dueState = taskDueState(task.dueDate, task.status, today)
            const assignee = resolveAssignee(task.assigneeUserId, members)
            return (
              <li key={task.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <HighPriorityFlag priority={task.priority} />
                  <span className="truncate">{task.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {assignee.kind === "member" && (
                    <Tooltip label={assignee.name}>
                      <Avatar name={assignee.name} image={assignee.image} size={18} />
                    </Tooltip>
                  )}
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      dueStateTextClass(dueState) || "text-[var(--color-muted-foreground)]",
                    )}
                  >
                    {task.dueDate ? formatDate(task.dueDate) : "no due date"}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
