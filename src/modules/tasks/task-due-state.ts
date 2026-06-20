/**
 * Pure due-date state for a task — the single source of truth shared by the
 * task-list color UI (viewer's local "today") and the AI summary prompt
 * (server "today"). No server-only / "use client" so it imports anywhere and
 * unit-tests directly.
 *
 * States (Mike-locked 2026-06-19):
 *   - done     → status === 'done' (UI keeps strikethrough + faded gray; NOT green)
 *   - overdue  → due_date < today AND not done (red)
 *   - due_soon → today ≤ due_date ≤ today+3, inclusive of today (yellow/amber)
 *   - normal   → due_date > today+3, OR no due date (regular)
 *
 * `today` is a YYYY-MM-DD civil date. Pass `null` to render the pre-hydration
 * state (SSR has no viewer-local date yet) — everything non-done resolves to
 * `normal` so the server HTML and first client render match (no hydration
 * mismatch); the client then re-renders with the real local `today`.
 *
 * Comparison is lexicographic on YYYY-MM-DD strings (no Date parse of stored
 * dates — same discipline as src/lib/format). The today+3 cutoff is computed
 * from explicit numeric components (local, no string-parse tz shift).
 */
export type TaskDueState = "done" | "overdue" | "due_soon" | "normal"

const DUE_SOON_DAYS = 3

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}

/** Add `days` to a YYYY-MM-DD civil date, returning YYYY-MM-DD. Uses the
 *  numeric Date constructor (local, no string parsing) purely for calendar
 *  arithmetic, then re-formats from local components. */
export function addDaysCivil(ymd: string, days: number): string {
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(5, 7))
  const d = Number(ymd.slice(8, 10))
  const dt = new Date(y, m - 1, d + days)
  return `${String(dt.getFullYear())}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

export function taskDueState(
  dueDate: string | null,
  status: string,
  today: string | null,
): TaskDueState {
  if (status === "done") return "done"
  if (!today || !dueDate) return "normal"
  const due = dueDate.slice(0, 10)
  if (due < today) return "overdue"
  if (due <= addDaysCivil(today, DUE_SOON_DAYS)) return "due_soon"
  return "normal"
}
