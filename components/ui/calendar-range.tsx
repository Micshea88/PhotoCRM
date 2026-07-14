"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Inline single-month calendar for picking a start/end date range — used by
 * the task filter strip's "All time → Custom" option (decision #3). Generic
 * primitive (YYYY-MM-DD in/out), reusable by any range filter.
 *
 * Interaction: first click sets the start (clears end); second click sets the
 * end (auto-swaps if earlier than the start); a click while a full range is
 * set starts over. Week columns start on Monday to match the app's Mon–Sun
 * ISO-week convention. `Date` is used only for grid layout (days-in-month /
 * weekday-of-first), never for comparing stored values — those stay
 * lexicographic on the YYYY-MM-DD strings.
 */
function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}
function ymd(y: number, m: number, d: number): string {
  return `${String(y)}-${pad2(m + 1)}-${pad2(d)}`
}
function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}
/** Monday-based weekday index (0=Mon … 6=Sun) of the 1st of the month. */
function mondayIndexOfFirst(y: number, m: number): number {
  const jsDay = new Date(y, m, 1).getDay() // 0=Sun … 6=Sat
  return (jsDay + 6) % 7
}

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

function viewFrom(anchor: string | null): { y: number; m: number } {
  const base = anchor ?? "2026-01-01"
  return { y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 }
}

export function CalendarRange({
  from,
  to,
  today,
  onChange,
}: {
  from: string | null
  to: string | null
  today: string | null
  onChange: (range: { from: string | null; to: string | null }) => void
}) {
  const [view, setView] = useState(() => viewFrom(to ?? from ?? today))

  function onDayClick(day: string) {
    // No start yet, or a complete range exists → begin a fresh range.
    if (!from || (from && to)) {
      onChange({ from: day, to: null })
      return
    }
    // Start set, end open → set end, swapping if the click precedes the start.
    if (day < from) onChange({ from: day, to: from })
    else onChange({ from, to: day })
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const m = v.m + delta
      if (m < 0) return { y: v.y - 1, m: 11 }
      if (m > 11) return { y: v.y + 1, m: 0 }
      return { y: v.y, m }
    })
  }

  const lead = mondayIndexOfFirst(view.y, view.m)
  const total = daysInMonth(view.y, view.m)
  const cells: (string | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= total; d++) cells.push(ymd(view.y, view.m, d))

  return (
    <div className="w-[15rem] select-none" data-testid="calendar-range">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            shiftMonth(-1)
          }}
          aria-label="Previous month"
          className="rounded p-1 hover:bg-[var(--state-hover)]"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-medium">
          {MONTH_LABELS[view.m]} {view.y}
        </span>
        <button
          type="button"
          onClick={() => {
            shiftMonth(1)
          }}
          aria-label="Next month"
          className="rounded p-1 hover:bg-[var(--state-hover)]"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="text-3xs grid grid-cols-7 gap-0.5 text-center text-[var(--color-muted-foreground)]">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-0.5 grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) return <span key={`blank-${String(i)}`} />
          const isStart = day === from
          const isEnd = day === to
          const inRange = from !== null && to !== null && day > from && day < to
          const isToday = day === today
          return (
            <button
              key={day}
              type="button"
              onClick={() => {
                onDayClick(day)
              }}
              className={cn(
                "flex h-7 items-center justify-center rounded text-xs tabular-nums hover:bg-[var(--state-hover)]",
                inRange && "bg-[var(--color-primary)]/10",
                (isStart || isEnd) &&
                  "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
                isToday && !isStart && !isEnd && "ring-1 ring-[var(--color-primary)]",
              )}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
