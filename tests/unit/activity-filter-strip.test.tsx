/**
 * Component tests for ActivityFilterStrip — tab-aware dropdown rendering +
 * URL writes via mocked next/navigation. The filter logic itself is covered
 * by activity-filter.test.ts.
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

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }))
let currentParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => currentParams,
}))

import { ActivityFilterStrip } from "@/modules/contacts/ui/activity-filter-strip"

const EVENTS = [{ id: "p1", name: "Kai Wedding" }]
const MEMBERS = [{ id: "u1", name: "Mike Shea", image: null }]

function renderStrip(initial = "") {
  replaceMock.mockClear()
  currentParams = new URLSearchParams(initial)
  return render(
    <ActivityFilterStrip
      eventOptions={EVENTS}
      memberOptions={MEMBERS}
      today="2026-06-20"
      shownCount={3}
      totalCount={9}
      filtersOpen
      onToggleFilters={vi.fn()}
    />,
  )
}

describe("ActivityFilterStrip — tab-aware dropdowns", () => {
  beforeEach(() => {
    replaceMock.mockClear()
  })

  it("All tab: shows All time + Event + Assigned to; no Direction/Outcome", () => {
    renderStrip()
    expect(screen.getByTestId("activity-filter-due")).toBeInTheDocument()
    expect(screen.getByTestId("activity-filter-event")).toBeInTheDocument()
    expect(screen.getByTestId("activity-filter-owner")).toBeInTheDocument()
    expect(screen.queryByTestId("activity-filter-direction")).toBeNull()
    expect(screen.queryByTestId("activity-filter-outcome")).toBeNull()
  })

  it("Calls tab: adds Direction + Outcome", () => {
    renderStrip("atab=call")
    expect(screen.getByTestId("activity-filter-direction")).toBeInTheDocument()
    expect(screen.getByTestId("activity-filter-outcome")).toBeInTheDocument()
  })

  it("Meetings tab: Outcome but no Direction", () => {
    renderStrip("atab=meeting")
    expect(screen.queryByTestId("activity-filter-direction")).toBeNull()
    expect(screen.getByTestId("activity-filter-outcome")).toBeInTheDocument()
  })

  it("Email tab: shows the Thread replies toggle and writes athread=1", async () => {
    const user = userEvent.setup()
    renderStrip("atab=email")
    await user.click(screen.getByTestId("activity-thread-toggle"))
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining("athread=1"), {
      scroll: false,
    })
  })

  it("selecting an owner writes the aowner param", async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.click(screen.getByTestId("activity-filter-owner"))
    await user.click(screen.getByRole("checkbox", { name: "Mike Shea" }))
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining("aowner=u1"), {
      scroll: false,
    })
  })

  it("Event menu includes the 'No event' sentinel; Owner includes 'Unassigned'", async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.click(screen.getByTestId("activity-filter-event"))
    expect(screen.getByRole("checkbox", { name: "No event" })).toBeInTheDocument()
    await user.click(screen.getByTestId("activity-filter-owner"))
    expect(screen.getByRole("checkbox", { name: "Unassigned" })).toBeInTheDocument()
  })

  it("renders pills + the X/Y count when filters are active", () => {
    renderStrip("aowner=u1")
    expect(screen.getByText("Assigned to: Mike Shea")).toBeInTheDocument()
    expect(screen.getByTestId("activity-filter-count")).toHaveTextContent("3/9")
  })
})
