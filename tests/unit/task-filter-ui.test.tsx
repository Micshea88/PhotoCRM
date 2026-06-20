/**
 * Component tests for the filter-strip UI: the reusable primitives (Avatar,
 * FilterPills, MultiSelectMenu, CalendarRange) and the task-specific
 * TaskFilterStrip composition (URL writes via mocked next/navigation). The
 * pure filter logic is covered separately in task-filter.test.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// next/image → plain img so jsdom renders avatars predictably.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />
  },
}))

// next/navigation — the strip reads useSearchParams + writes via router.replace.
const replaceMock = vi.fn()
let currentParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => currentParams,
}))

import { Avatar } from "@/components/ui/avatar"
import { FilterPills } from "@/components/ui/filter-pills"
import { MultiSelectMenu } from "@/components/ui/multi-select-menu"
import { CalendarRange } from "@/components/ui/calendar-range"
import { TaskFilterStrip } from "@/modules/tasks/ui/task-filter-strip"

describe("Avatar", () => {
  it("renders initials from a full name", () => {
    render(<Avatar name="Mike Shea" />)
    expect(screen.getByText("MS")).toBeInTheDocument()
  })

  it("renders two letters from a single name", () => {
    render(<Avatar name="Kelly" />)
    expect(screen.getByText("KE")).toBeInTheDocument()
  })

  it("renders the photo when an image is provided", () => {
    render(<Avatar name="Mike Shea" image="https://example.com/m.png" />)
    const img = screen.getByAltText("Mike Shea")
    expect(img).toHaveAttribute("src", "https://example.com/m.png")
  })
})

describe("FilterPills", () => {
  it("renders nothing when there are no pills", () => {
    const { container } = render(<FilterPills pills={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders pills, fires onRemove and onClearAll", async () => {
    const onRemove = vi.fn()
    const onClearAll = vi.fn()
    const user = userEvent.setup()
    render(
      <FilterPills
        pills={[{ key: "status:done", label: "Task status: Completed", onRemove }]}
        onClearAll={onClearAll}
      />,
    )
    expect(screen.getByText("Task status: Completed")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Remove filter/ }))
    expect(onRemove).toHaveBeenCalledOnce()
    await user.click(screen.getByText("Clear all filters"))
    expect(onClearAll).toHaveBeenCalledOnce()
  })
})

describe("MultiSelectMenu", () => {
  it("opens, shows options, and toggles selection (OR within)", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <MultiSelectMenu
        label="Priority"
        options={[
          { value: "high", label: "High" },
          { value: "none", label: "No priority", dividerBefore: true },
        ]}
        values={[]}
        onChange={onChange}
        testId="pri"
      />,
    )
    await user.click(screen.getByTestId("pri"))
    await user.click(screen.getByRole("checkbox", { name: "High" }))
    expect(onChange).toHaveBeenCalledWith(["high"])
  })

  it("shows a count badge when values are active", () => {
    render(
      <MultiSelectMenu
        label="Priority"
        options={[{ value: "high", label: "High" }]}
        values={["high"]}
        onChange={vi.fn()}
        testId="pri"
      />,
    )
    expect(screen.getByTestId("pri")).toHaveTextContent("1")
  })
})

describe("CalendarRange", () => {
  it("sets start on first click, end on second", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <CalendarRange from={null} to={null} today="2026-06-20" onChange={onChange} />,
    )
    await user.click(screen.getByRole("button", { name: "10" }))
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-06-10", to: null })

    rerender(<CalendarRange from="2026-06-10" to={null} today="2026-06-20" onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: "15" }))
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-06-10", to: "2026-06-15" })
  })

  it("swaps when the second click precedes the start", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<CalendarRange from="2026-06-15" to={null} today="2026-06-20" onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: "10" }))
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-06-10", to: "2026-06-15" })
  })
})

describe("TaskFilterStrip — URL writes", () => {
  const events = [{ id: "p1", name: "Kai Wedding" }]
  const members = [{ id: "u1", name: "Mike Shea", image: null }]

  function renderStrip(initial = "") {
    replaceMock.mockClear()
    currentParams = new URLSearchParams(initial)
    return render(
      <TaskFilterStrip
        eventOptions={events}
        memberOptions={members}
        today="2026-06-20"
        createSlot={<button type="button">Create a task</button>}
        filtersOpen
        onToggleFilters={vi.fn()}
      />,
    )
  }

  it("renders the five dropdowns when filters are open", () => {
    renderStrip()
    expect(screen.getByTestId("task-filter-due")).toBeInTheDocument()
    expect(screen.getByTestId("task-filter-event")).toBeInTheDocument()
    expect(screen.getByTestId("task-filter-status")).toBeInTheDocument()
    expect(screen.getByTestId("task-filter-priority")).toBeInTheDocument()
    expect(screen.getByTestId("task-filter-assignee")).toBeInTheDocument()
  })

  it("toggling sort-by-priority writes sortByPri=1", async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.click(screen.getByTestId("task-sort-priority"))
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining("sortByPri=1"), {
      scroll: false,
    })
  })

  it("selecting a status writes the status param", async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.click(screen.getByTestId("task-filter-status"))
    await user.click(screen.getByRole("checkbox", { name: "In progress" }))
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining("status=in_progress"), {
      scroll: false,
    })
  })

  it("renders active-filter pills from the URL and removes one on ✕", async () => {
    const user = userEvent.setup()
    renderStrip("status=done")
    expect(screen.getByText("Task status: Completed")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Remove filter/ }))
    // Removing the only status clears the param entirely.
    const lastCall = replaceMock.mock.calls.at(-1)
    expect(lastCall?.[0]).not.toContain("status=")
  })

  it("preserves the tab param when writing filters", async () => {
    const user = userEvent.setup()
    renderStrip("tab=tasks")
    await user.click(screen.getByTestId("task-sort-priority"))
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("tab=tasks")
  })
})
