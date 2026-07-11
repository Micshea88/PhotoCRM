/**
 * STEP 3 — unified "mark all" toggle on the /notifications page header (LAW 7:
 * assert the observable result). Unread present → button reads "Mark all read";
 * click → the visible rows become read AND the label flips to "Mark all unread";
 * click again → reverses. The bulk mocks flip a shared server state that the
 * fetch mock reflects, so the rendered read-state + label track the real flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const state = vi.hoisted(() => ({ allRead: false }))

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock("@/modules/notifications/actions", () => ({
  markNotificationRead: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  markNotificationUnread: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  archiveNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  unarchiveNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  unarchiveNotificationsBulk: vi.fn().mockResolvedValue({ data: { count: 1 } }),
  snoozeNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  unsnoozeNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  createTaskFromNotification: vi.fn().mockResolvedValue({ data: { taskId: "t1" } }),
  markNotificationsReadBulk: vi.fn(() => {
    state.allRead = true
    return Promise.resolve({ data: { count: 2 } })
  }),
  markNotificationsUnreadBulk: vi.fn(() => {
    state.allRead = false
    return Promise.resolve({ data: { count: 2 } })
  }),
  snoozeNotificationsBulk: vi.fn().mockResolvedValue({ data: { count: 2 } }),
  archiveNotificationsBulk: vi.fn().mockResolvedValue({ data: { count: 2 } }),
}))

function row(id: string) {
  return {
    id,
    organizationId: "org1",
    recipientUserId: "u1",
    type: "email.bounced",
    category: "messages_email",
    tier: "critical",
    title: `Notification ${id}`,
    body: null,
    linkPath: null,
    contactId: null,
    payload: null,
    sourceModule: "email",
    // Reflects the shared server state at fetch time.
    readAt: state.allRead ? new Date("2026-07-07T10:00:00Z").toISOString() : null,
    archivedAt: null,
    snoozedUntil: null,
    scheduledFor: null,
    emailSentAt: null,
    createdAt: new Date("2026-07-07T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-07-07T10:00:00Z").toISOString(),
    contactName: null,
  }
}

beforeEach(() => {
  state.allRead = false
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            notifications: [row("n1"), row("n2")],
            unreadCount: state.allRead ? 0 : 2,
            notificationContacts: [],
          }),
      }),
    ),
  )
  if (typeof window === "undefined") return
  for (const m of ["hasPointerCapture", "releasePointerCapture", "setPointerCapture", "scrollIntoView"]) {
    Object.defineProperty(Element.prototype, m, { configurable: true, value: () => undefined })
  }
})

import { NotificationsPageClient } from "@/modules/notifications/ui/notifications-page-client"

describe("NotificationsPageClient — unified mark-all toggle (STEP 3 / LAW 7)", () => {
  it("marks the visible rows read + flips the label, then reverses", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.getAllByTestId("notification-row").length).toBe(2)
    })

    // Unread present → button reads "Mark all read", rows show unread dots.
    const toggle = screen.getByTestId("mark-all-toggle")
    expect(toggle).toHaveTextContent("Mark all read")
    expect(screen.getAllByTestId("notification-read-dot").length).toBe(2)

    // Click → visible rows become read AND the label flips to "Mark all unread".
    await user.click(toggle)
    await waitFor(() => {
      expect(screen.getByTestId("mark-all-toggle")).toHaveTextContent("Mark all unread")
    })
    expect(screen.queryAllByTestId("notification-read-dot").length).toBe(0)

    // Click again → reverses: rows unread, label back to "Mark all read".
    await user.click(screen.getByTestId("mark-all-toggle"))
    await waitFor(() => {
      expect(screen.getByTestId("mark-all-toggle")).toHaveTextContent("Mark all read")
    })
    expect(screen.getAllByTestId("notification-read-dot").length).toBe(2)
  })
})
