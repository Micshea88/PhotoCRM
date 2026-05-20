import { formatDate } from "@/lib/format"

export interface TasksDueListTask {
  id: string
  title: string
  dueDate: string | null
}

export interface TasksDueListProps {
  /** Top N tasks to display (typically 3). */
  topTasks: TasksDueListTask[]
  /** Total count across the window (may exceed topTasks.length). */
  totalCount: number
}

/**
 * Renders the "Tasks due this week" card — a count headline plus the
 * top three by due date. Per LOC1, the empty state names a concrete
 * next step instead of just rendering a zero.
 */
export function TasksDueList({ topTasks, totalCount }: TasksDueListProps) {
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
          {topTasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{task.title}</span>
              <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
                {task.dueDate ? formatDate(task.dueDate) : "no due date"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
