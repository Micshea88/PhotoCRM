import { formatDate } from "@/lib/format"

export interface TeamThisWeekTask {
  id: string
  title: string
  dueDate: string | null
  assigneeUserId: string | null
}

export interface TeamThisWeekProps {
  tasks: TeamThisWeekTask[]
  hasSeedView: boolean
}

interface Group {
  assigneeUserId: string | null
  tasks: TeamThisWeekTask[]
}

function groupByAssignee(tasks: TeamThisWeekTask[]): Group[] {
  const byId = new Map<string | null, TeamThisWeekTask[]>()
  for (const task of tasks) {
    const key = task.assigneeUserId
    const existing = byId.get(key)
    if (existing) existing.push(task)
    else byId.set(key, [task])
  }
  return Array.from(byId.entries()).map(([assigneeUserId, list]) => ({
    assigneeUserId,
    tasks: list,
  }))
}

/**
 * Renders the seeded "Team This Week" saved view as a grouped task
 * list (grouped by assignee). Per LOC1 (plain-language empty state):
 * if the saved view doesn't exist for the studio (a fresh studio not
 * yet seeded) we show a "what to do next" message, NOT a blank pane.
 */
export function TeamThisWeek({ tasks, hasSeedView }: TeamThisWeekProps) {
  if (!hasSeedView) {
    return (
      <section className="space-y-2 rounded-lg border border-[var(--color-border)] p-4">
        <h2 className="text-sm font-medium text-[var(--color-muted-foreground)]">Team This Week</h2>
        <p className="text-sm">
          The Team This Week view isn&rsquo;t set up for this studio yet. Once you create some tasks
          with due dates, the team breakdown will show up here.
        </p>
      </section>
    )
  }

  if (tasks.length === 0) {
    return (
      <section className="space-y-2 rounded-lg border border-[var(--color-border)] p-4">
        <h2 className="text-sm font-medium text-[var(--color-muted-foreground)]">Team This Week</h2>
        <p className="text-sm">No tasks scheduled this week.</p>
      </section>
    )
  }

  const groups = groupByAssignee(tasks)
  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <h2 className="text-sm font-medium text-[var(--color-muted-foreground)]">Team This Week</h2>
      <ul className="space-y-3">
        {groups.map((group) => (
          <li key={group.assigneeUserId ?? "_unassigned"} className="space-y-1">
            <p className="text-xs font-medium text-[var(--color-muted-foreground)]">
              {group.assigneeUserId ? `Assigned to ${group.assigneeUserId}` : "Unassigned"}
            </p>
            <ul className="space-y-1">
              {group.tasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{task.title}</span>
                  <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                    {task.dueDate ? formatDate(task.dueDate) : "no due date"}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}
