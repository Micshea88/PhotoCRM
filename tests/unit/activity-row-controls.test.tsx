/**
 * Tests for ActivityRowControls (Phase D2): per-row event picker + outcome
 * quick-set, dispatching the right update action by kind. Update actions +
 * navigation are mocked so the component renders in jsdom.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const { refreshMock, updateNote, updateCall, updateMeeting, updateEmail } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  updateNote: vi.fn((_i: unknown) => Promise.resolve({ data: { id: "x" } })),
  updateCall: vi.fn((_i: unknown) => Promise.resolve({ data: { id: "x" } })),
  updateMeeting: vi.fn((_i: unknown) => Promise.resolve({ data: { id: "x" } })),
  updateEmail: vi.fn((_i: unknown) => Promise.resolve({ data: { id: "x" } })),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("@/modules/contacts/actions", () => ({ updateContactNote: updateNote }))
vi.mock("@/modules/calls/actions", () => ({ updateCall }))
vi.mock("@/modules/meetings/actions", () => ({ updateMeeting }))
vi.mock("@/modules/email-log/actions", () => ({ updateEmail }))

import { ActivityRowControls } from "@/modules/contacts/ui/activity-row-controls"

const EVENTS = [{ id: "p1", name: "Kai Wedding" }]

describe("ActivityRowControls", () => {
  beforeEach(() => {
    updateNote.mockClear()
    updateCall.mockClear()
    updateMeeting.mockClear()
    updateEmail.mockClear()
  })

  it("note row: event chip only (no outcome); setting an event calls updateContactNote", async () => {
    const user = userEvent.setup()
    render(
      <ActivityRowControls
        entry={{ kind: "note", rawId: "n1", projectId: null }}
        eventOptions={EVENTS}
      />,
    )
    expect(screen.getByTestId("activity-event-note")).toBeInTheDocument()
    expect(screen.queryByTestId("activity-outcome-note")).toBeNull()
    await user.click(screen.getByTestId("activity-event-note"))
    await user.click(screen.getByRole("option", { name: "Kai Wedding" }))
    expect(updateNote).toHaveBeenCalledWith({ id: "n1", projectId: "p1" })
  })

  it("call row: outcome quick-set calls updateCall with the disposition", async () => {
    const user = userEvent.setup()
    render(
      <ActivityRowControls
        entry={{ kind: "call", rawId: "c1", projectId: null, callDisposition: null }}
        eventOptions={EVENTS}
      />,
    )
    expect(screen.getByTestId("activity-event-call")).toBeInTheDocument()
    await user.click(screen.getByTestId("activity-outcome-call"))
    await user.click(screen.getByRole("option", { name: "Left Voicemail" }))
    expect(updateCall).toHaveBeenCalledWith({ id: "c1", disposition: "voicemail" })
  })

  it("meeting row: outcome quick-set calls updateMeeting; event picker clears via 'No event'", async () => {
    const user = userEvent.setup()
    render(
      <ActivityRowControls
        entry={{ kind: "meeting", rawId: "m1", projectId: "p1", outcome: null }}
        eventOptions={EVENTS}
      />,
    )
    await user.click(screen.getByTestId("activity-outcome-meeting"))
    await user.click(screen.getByRole("option", { name: "No show" }))
    expect(updateMeeting).toHaveBeenCalledWith({ id: "m1", outcome: "No show" })

    await user.click(screen.getByTestId("activity-event-meeting"))
    await user.click(screen.getByRole("option", { name: "No event" }))
    expect(updateMeeting).toHaveBeenCalledWith({ id: "m1", projectId: null })
  })

  it("sms row: renders nothing (event picker deferred to Commit 4)", () => {
    const { container } = render(
      <ActivityRowControls entry={{ kind: "sms", rawId: "s1" }} eventOptions={EVENTS} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
