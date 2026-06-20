/**
 * Component tests for the task assignee picker (Mike-locked 2026-06-20):
 * the SingleSelectMenu primitive (select + close-on-pick), the AssigneeAvatar
 * empty "+" state, the AssigneePicker onChange contract, and pane-level
 * behavior — new tasks default to the creator (decision #1) and the row avatar
 * quick-reassigns via updateTask (decision #4) on any row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />
  },
}))

// vi.hoisted: these run before the hoisted vi.mock factories that reference them.
const { replaceMock, refreshMock, createTaskMock, updateTaskMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  createTaskMock: vi.fn((_input: unknown) => Promise.resolve({ data: { id: "new" } })),
  updateTaskMock: vi.fn((_input: unknown) => Promise.resolve({ data: { id: "t1" } })),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(),
}))

// Task server actions — replaced with spies so the pane renders in jsdom.
vi.mock("@/modules/tasks/actions", () => ({
  createTask: createTaskMock,
  updateTask: updateTaskMock,
  markTaskDone: vi.fn(() => Promise.resolve({})),
  markTaskNotDone: vi.fn(() => Promise.resolve({})),
  deleteTask: vi.fn(() => Promise.resolve({})),
  associateTaskEvent: vi.fn(() => Promise.resolve({})),
  removeTaskEvent: vi.fn(() => Promise.resolve({})),
}))

// EventPicker pulls project UI we don't need here — stub it.
vi.mock("@/modules/projects/ui/event-picker", () => ({
  EventPicker: () => <div data-testid="event-picker-stub" />,
}))

import { SingleSelectMenu } from "@/components/ui/single-select-menu"
import { AssigneeAvatar, AssigneePicker } from "@/modules/tasks/ui/assignee-picker"
import { ContactTasksPane, type ContactTaskItem } from "@/modules/tasks/ui/contact-tasks-pane"

const MEMBERS = [
  { id: "u1", name: "Mike Shea", image: null },
  { id: "u2", name: "Kelly Stone", image: null },
]

describe("SingleSelectMenu", () => {
  it("opens, selects a value, and closes on pick", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SingleSelectMenu
        options={[
          { value: "a", label: "Apple" },
          { value: "b", label: "Banana" },
        ]}
        value={null}
        onChange={onChange}
        trigger={({ toggle }) => (
          <button type="button" onClick={toggle}>
            open
          </button>
        )}
      />,
    )
    await user.click(screen.getByText("open"))
    expect(screen.getByRole("option", { name: "Apple" })).toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: "Apple" }))
    expect(onChange).toHaveBeenCalledWith("a")
    // Closed after pick.
    expect(screen.queryByRole("option", { name: "Apple" })).not.toBeInTheDocument()
  })
})

describe("AssigneeAvatar", () => {
  it("shows the greyed empty '+' when unassigned", () => {
    render(<AssigneeAvatar member={null} />)
    expect(screen.getByTestId("assignee-empty")).toBeInTheDocument()
  })

  it("shows the member initials when assigned", () => {
    render(<AssigneeAvatar member={{ id: "u1", name: "Mike Shea", image: null }} />)
    expect(screen.getByText("MS")).toBeInTheDocument()
  })
})

describe("AssigneePicker", () => {
  it("selecting a member emits their id; Unassigned emits null", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <AssigneePicker members={MEMBERS} value={null} onChange={onChange} />,
    )
    // Unassigned trigger shows the empty "+".
    expect(screen.getByTestId("assignee-empty")).toBeInTheDocument()
    await user.click(screen.getByTestId("task-assignee-trigger"))
    await user.click(screen.getByRole("option", { name: /Kelly Stone/ }))
    expect(onChange).toHaveBeenLastCalledWith("u2")

    rerender(<AssigneePicker members={MEMBERS} value="u2" onChange={onChange} />)
    await user.click(screen.getByTestId("task-assignee-trigger"))
    await user.click(screen.getByRole("option", { name: "Unassigned" }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe("ContactTasksPane — assignee wiring", () => {
  beforeEach(() => {
    createTaskMock.mockClear()
    updateTaskMock.mockClear()
  })

  function task(overrides: Partial<ContactTaskItem> = {}): ContactTaskItem {
    return {
      id: "t1",
      title: "Edit gallery",
      dueDate: null,
      status: "not_started",
      completedAt: null,
      projectId: null,
      eventName: null,
      priority: null,
      assigneeUserId: null,
      ...overrides,
    }
  }

  it("new tasks default to the creator (decision #1)", async () => {
    const user = userEvent.setup()
    render(
      <ContactTasksPane
        contactId="c1"
        tasks={[]}
        eventOptions={[]}
        members={MEMBERS}
        currentUserId="u1"
      />,
    )
    await user.click(screen.getByTestId("contact-tasks-add"))
    // The form's assignee control shows the creator by default.
    expect(screen.getByTestId("task-assignee-trigger")).toHaveTextContent("Mike Shea")
    await user.type(screen.getByTestId("contact-tasks-add-title"), "New task")
    await user.click(screen.getByRole("button", { name: "Add task" }))
    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserId: "u1" }))
  })

  it("row avatar quick-reassigns via updateTask, no edit mode (decision #4)", async () => {
    const user = userEvent.setup()
    render(
      <ContactTasksPane
        contactId="c1"
        tasks={[task({ assigneeUserId: null })]}
        eventOptions={[]}
        members={MEMBERS}
        currentUserId="u1"
      />,
    )
    // The unassigned row shows the empty "+" avatar.
    expect(screen.getByTestId("assignee-empty")).toBeInTheDocument()
    await user.click(screen.getByTestId("task-assignee-trigger"))
    await user.click(screen.getByRole("option", { name: /Kelly Stone/ }))
    expect(updateTaskMock).toHaveBeenCalledWith({ id: "t1", assigneeUserId: "u2" })
  })

  it("quick-reassign works on a completed row too (decision #3)", async () => {
    const user = userEvent.setup()
    render(
      <ContactTasksPane
        contactId="c1"
        tasks={[
          task({ status: "done", completedAt: "2026-06-10T10:00:00Z", assigneeUserId: "u1" }),
        ]}
        eventOptions={[]}
        members={MEMBERS}
        currentUserId="u1"
      />,
    )
    // Completed section is collapsed by default — expand it first.
    await user.click(screen.getByTestId("contact-tasks-completed-toggle"))
    await user.click(screen.getByTestId("task-assignee-trigger"))
    await user.click(screen.getByRole("option", { name: "Unassigned" }))
    expect(updateTaskMock).toHaveBeenCalledWith({ id: "t1", assigneeUserId: null })
  })
})
