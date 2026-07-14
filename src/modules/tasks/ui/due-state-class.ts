import type { TaskDueState } from "@/modules/tasks/task-due-state"

/**
 * Tailwind text-color class for a task's due state (Mike, 2026-06-19):
 * overdue = red, due-soon = amber. Normal + done get no tint — a done task
 * is already dimmed/struck-through, and a normal task stays default-colored.
 *
 * Shared by every task surface (contact Tasks tab + the dashboard widgets) so
 * the color language stays identical. Pure string logic — no React, no tokens
 * beyond the class name — so it's safe to import from server or client.
 */
export function dueStateTextClass(state: TaskDueState): string {
  switch (state) {
    case "overdue":
      return "text-[var(--color-destructive)]"
    case "due_soon":
      return "text-[var(--color-warning)]"
    default:
      return ""
  }
}
