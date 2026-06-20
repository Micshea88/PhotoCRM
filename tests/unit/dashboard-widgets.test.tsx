/**
 * Component tests for the dashboard widgets. Each widget gets:
 *   - a populated-state assertion
 *   - an empty-state assertion (LOC1 — empty states say what to do next)
 *   - any prop-variant edge case
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { WelcomeHeader } from "@/modules/dashboard/ui/welcome-header"
import { CountCard } from "@/modules/dashboard/ui/count-card"
import { TeamThisWeek } from "@/modules/dashboard/ui/team-this-week"
import { TasksDueList } from "@/modules/dashboard/ui/tasks-due-list"

describe("WelcomeHeader", () => {
  it("renders first name and studio name", () => {
    render(<WelcomeHeader userFirstName="Mike" studioName="Acme Studio" />)
    expect(screen.getByRole("heading")).toHaveTextContent("Welcome, Mike — Acme Studio")
  })
})

describe("CountCard", () => {
  it("renders count=0", () => {
    render(<CountCard label="Open opportunities" count={0} />)
    expect(screen.getByText("Open opportunities")).toBeInTheDocument()
    expect(screen.getByText("0")).toBeInTheDocument()
  })

  it("renders count=12", () => {
    render(<CountCard label="Open opportunities" count={12} />)
    expect(screen.getByText("12")).toBeInTheDocument()
  })

  it("renders the hint when provided", () => {
    render(
      <CountCard
        label="Open opportunities"
        count={0}
        hint="Log an inquiry to start your pipeline."
      />,
    )
    expect(screen.getByText("Log an inquiry to start your pipeline.")).toBeInTheDocument()
  })

  it("omits the hint paragraph when not provided", () => {
    render(<CountCard label="Open opportunities" count={5} />)
    expect(screen.queryByText(/inquiry/)).not.toBeInTheDocument()
  })
})

describe("TeamThisWeek", () => {
  it("renders the no-seed-view explanation for an unseeded studio", () => {
    render(<TeamThisWeek tasks={[]} hasSeedView={false} />)
    expect(screen.getByText(/isn.t set up for this studio yet/)).toBeInTheDocument()
  })

  it("renders the empty-week message when seeded but no tasks", () => {
    render(<TeamThisWeek tasks={[]} hasSeedView={true} />)
    expect(screen.getByText(/No tasks scheduled this week/)).toBeInTheDocument()
  })

  it("groups tasks by assignee and shows due dates", () => {
    render(
      <TeamThisWeek
        hasSeedView={true}
        tasks={[
          {
            id: "t1",
            title: "Edit RAW",
            dueDate: "2026-05-19",
            assigneeUserId: "user_a",
            status: "ready",
            priority: null,
          },
          {
            id: "t2",
            title: "Send invoice",
            dueDate: "2026-05-21",
            assigneeUserId: "user_a",
            status: "ready",
            priority: "high",
          },
          {
            id: "t3",
            title: "Confirm venue",
            dueDate: "2026-05-22",
            assigneeUserId: "user_b",
            status: "ready",
            priority: null,
          },
        ]}
      />,
    )
    expect(screen.getByText("Edit RAW")).toBeInTheDocument()
    expect(screen.getByText("Send invoice")).toBeInTheDocument()
    expect(screen.getByText("Confirm venue")).toBeInTheDocument()
    expect(screen.getAllByText(/Assigned to/)).toHaveLength(2)
    expect(screen.getByText("05/19/2026")).toBeInTheDocument()
  })

  it("groups null-assignee tasks under 'Unassigned'", () => {
    render(
      <TeamThisWeek
        hasSeedView={true}
        tasks={[
          {
            id: "t1",
            title: "Orphan task",
            dueDate: null,
            assigneeUserId: null,
            status: "ready",
            priority: null,
          },
        ]}
      />,
    )
    expect(screen.getByText("Unassigned")).toBeInTheDocument()
    expect(screen.getByText("no due date")).toBeInTheDocument()
  })
})

describe("TasksDueList", () => {
  it("renders count=0 with a do-next hint", () => {
    render(<TasksDueList totalCount={0} topTasks={[]} />)
    expect(screen.getByText("0")).toBeInTheDocument()
    expect(screen.getByText(/Add a task to get started/)).toBeInTheDocument()
  })

  it("renders top 3 tasks with formatted due dates", () => {
    render(
      <TasksDueList
        totalCount={5}
        topTasks={[
          { id: "t1", title: "Task A", dueDate: "2026-05-17", status: "ready", priority: null },
          { id: "t2", title: "Task B", dueDate: "2026-05-18", status: "ready", priority: "high" },
          { id: "t3", title: "Task C", dueDate: "2026-05-20", status: "ready", priority: null },
        ]}
      />,
    )
    expect(screen.getByText("5")).toBeInTheDocument()
    expect(screen.getByText("Task A")).toBeInTheDocument()
    expect(screen.getByText("Task B")).toBeInTheDocument()
    expect(screen.getByText("Task C")).toBeInTheDocument()
    expect(screen.getByText("05/17/2026")).toBeInTheDocument()
  })

  it("handles a task with no due date gracefully", () => {
    render(
      <TasksDueList
        totalCount={1}
        topTasks={[{ id: "t1", title: "Floater", dueDate: null, status: "ready", priority: null }]}
      />,
    )
    expect(screen.getByText("Floater")).toBeInTheDocument()
    expect(screen.getByText("no due date")).toBeInTheDocument()
  })

  it("renders the High-priority flag only for high-priority tasks", () => {
    render(
      <TasksDueList
        totalCount={2}
        topTasks={[
          { id: "t1", title: "Plain", dueDate: "2026-05-17", status: "ready", priority: null },
          { id: "t2", title: "Urgent", dueDate: "2026-05-18", status: "ready", priority: "high" },
        ]}
      />,
    )
    // One flag total — the high-priority task only (Low/Medium/none render none).
    expect(screen.getAllByLabelText("High priority")).toHaveLength(1)
  })
})
