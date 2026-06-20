/**
 * Unit tests for the pure due-date state helper (Mike-locked 2026-06-19).
 * This is the single source of truth shared by the task-list color UI and the
 * AI summary prompt, so its boundary behavior (done override, null today,
 * inclusive due-soon window, lexicographic compare, month/year rollover in
 * addDaysCivil) is locked here.
 */
import { describe, it, expect } from "vitest"
import { taskDueState, addDaysCivil } from "@/modules/tasks/task-due-state"

const TODAY = "2026-06-19"

describe("taskDueState", () => {
  it("done status overrides everything (even a past due date)", () => {
    expect(taskDueState("2020-01-01", "done", TODAY)).toBe("done")
    expect(taskDueState(null, "done", TODAY)).toBe("done")
  })

  it("returns normal when today is unknown (pre-hydration SSR snapshot)", () => {
    expect(taskDueState("2020-01-01", "ready", null)).toBe("normal")
  })

  it("returns normal when there is no due date", () => {
    expect(taskDueState(null, "ready", TODAY)).toBe("normal")
  })

  it("flags a due date strictly before today as overdue", () => {
    expect(taskDueState("2026-06-18", "ready", TODAY)).toBe("overdue")
  })

  it("treats today itself as due_soon, not overdue", () => {
    expect(taskDueState("2026-06-19", "ready", TODAY)).toBe("due_soon")
  })

  it("includes the full today..today+3 window as due_soon (inclusive)", () => {
    expect(taskDueState("2026-06-22", "ready", TODAY)).toBe("due_soon") // +3
  })

  it("anything past today+3 is normal", () => {
    expect(taskDueState("2026-06-23", "ready", TODAY)).toBe("normal") // +4
  })

  it("compares only the date portion of a timestamp-ish dueDate", () => {
    expect(taskDueState("2026-06-18T23:59:59Z", "ready", TODAY)).toBe("overdue")
  })
})

describe("addDaysCivil", () => {
  it("adds days within a month", () => {
    expect(addDaysCivil("2026-06-19", 3)).toBe("2026-06-22")
  })

  it("rolls over a month boundary", () => {
    expect(addDaysCivil("2026-06-29", 3)).toBe("2026-07-02")
  })

  it("rolls over a year boundary", () => {
    expect(addDaysCivil("2026-12-30", 3)).toBe("2027-01-02")
  })

  it("zero-pads single-digit month/day", () => {
    expect(addDaysCivil("2026-01-05", 3)).toBe("2026-01-08")
  })
})
