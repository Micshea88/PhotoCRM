/**
 * Unit tests for Section E3 — multi-select + bulk action bar on
 * notifications-page-client.tsx and the per-row checkbox in notification-row.tsx.
 *
 * Tests:
 *   - Selecting rows shows the bulk bar with the right "N selected" count
 *   - "Clear selection" button empties the selection and hides the bar
 *   - Each bulk action button invokes the correct server action with selected IDs
 *   - Checkbox click does NOT trigger row navigation (stopPropagation)
 *   - Bell dropdown rows do NOT render a checkbox (no selectable prop)
 *   - Page rows DO render a checkbox (selectable prop present)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [k: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

let mockRouterPush: ReturnType<typeof vi.fn>
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock("@/modules/notifications/actions", () => ({
  markNotificationRead: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  markNotificationUnread: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  archiveNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  snoozeNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  unsnoozeNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  createTaskFromNotification: vi.fn().mockResolvedValue({ data: { taskId: "t1" } }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ data: { count: 0 } }),
  markAllNotificationsUnread: vi.fn().mockResolvedValue({ data: { count: 0 } }),
  markNotificationsReadBulk: vi.fn().mockResolvedValue({ data: { count: 1 } }),
  markNotificationsUnreadBulk: vi.fn().mockResolvedValue({ data: { count: 1 } }),
  snoozeNotificationsBulk: vi.fn().mockResolvedValue({ data: { count: 1 } }),
  archiveNotificationsBulk: vi.fn().mockResolvedValue({ data: { count: 1 } }),
}))

// Fetch stub for NotificationsPageClient
const FETCH_RESPONSE = {
  notifications: [
    {
      id: "n1",
      organizationId: "org1",
      recipientUserId: "u1",
      type: "email.bounced",
      category: "messages_email",
      tier: "critical",
      title: "Email bounced",
      body: null,
      linkPath: null,
      contactId: null,
      payload: null,
      sourceModule: "email",
      readAt: null,
      archivedAt: null,
      snoozedUntil: null,
      scheduledFor: null,
      emailSentAt: null,
      createdAt: new Date("2026-07-07T10:00:00Z").toISOString(),
      updatedAt: new Date("2026-07-07T10:00:00Z").toISOString(),
      contactName: null,
    },
    {
      id: "n2",
      organizationId: "org1",
      recipientUserId: "u1",
      type: "email.bounced",
      category: "messages_email",
      tier: "critical",
      title: "Payment overdue",
      body: null,
      linkPath: null,
      contactId: null,
      payload: null,
      sourceModule: "email",
      readAt: null,
      archivedAt: null,
      snoozedUntil: null,
      scheduledFor: null,
      emailSentAt: null,
      createdAt: new Date("2026-07-07T09:00:00Z").toISOString(),
      updatedAt: new Date("2026-07-07T09:00:00Z").toISOString(),
      contactName: null,
    },
  ],
  unreadCount: 2,
  notificationContacts: [],
}

vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(FETCH_RESPONSE),
  }),
)

// Radix Popover pointer-event shim
beforeEach(() => {
  mockRouterPush = vi.fn()
  if (typeof window === "undefined") return
  Object.defineProperty(Element.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  })
  Object.defineProperty(Element.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  })
  Object.defineProperty(Element.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  })
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  })
})

import { NotificationsPageClient } from "@/modules/notifications/ui/notifications-page-client"
import { NotificationRow } from "@/modules/notifications/ui/notification-row"
import {
  markNotificationsReadBulk,
  markNotificationsUnreadBulk,
  archiveNotificationsBulk,
  snoozeNotificationsBulk,
  markNotificationRead,
} from "@/modules/notifications/actions"
import type { NotificationWithContact } from "@/modules/notifications/queries"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotification(
  overrides: Partial<NotificationWithContact> = {},
): NotificationWithContact {
  return {
    id: "n1",
    organizationId: "org1",
    recipientUserId: "u1",
    type: "email.bounced",
    category: "messages_email",
    tier: "critical",
    title: "Email bounced to client@example.com",
    body: null,
    linkPath: null,
    contactId: null,
    payload: null,
    sourceModule: "email",
    readAt: null,
    archivedAt: null,
    snoozedUntil: null,
    scheduledFor: null,
    emailSentAt: null,
    createdAt: new Date("2026-07-07T10:00:00Z"),
    updatedAt: new Date("2026-07-07T10:00:00Z"),
    contactName: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// NotificationRow — checkbox visibility gate
// ---------------------------------------------------------------------------

describe("NotificationRow — checkbox (E3 selectable prop)", () => {
  it("renders NO checkbox when selectable is not passed (bell dropdown mode)", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.queryByTestId("notification-select-checkbox")).toBeNull()
  })

  it("renders NO checkbox when selectable is false", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} selectable={false} />)
    expect(screen.queryByTestId("notification-select-checkbox")).toBeNull()
  })

  it("renders a checkbox when selectable is true", () => {
    const n = makeNotification()
    render(
      <NotificationRow
        notification={n}
        onRefresh={vi.fn()}
        selectable={true}
        selected={false}
        onToggleSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId("notification-select-checkbox")).toBeInTheDocument()
  })

  it("checkbox is checked when selected is true", () => {
    const n = makeNotification()
    render(
      <NotificationRow
        notification={n}
        onRefresh={vi.fn()}
        selectable={true}
        selected={true}
        onToggleSelect={vi.fn()}
      />,
    )
    const checkbox = screen.getByTestId("notification-select-checkbox")
    expect(checkbox).toBeChecked()
  })

  it("checkbox is unchecked when selected is false", () => {
    const n = makeNotification()
    render(
      <NotificationRow
        notification={n}
        onRefresh={vi.fn()}
        selectable={true}
        selected={false}
        onToggleSelect={vi.fn()}
      />,
    )
    const checkbox = screen.getByTestId("notification-select-checkbox")
    expect(checkbox).not.toBeChecked()
  })

  it("clicking the checkbox calls onToggleSelect with the notification id", async () => {
    const user = userEvent.setup()
    const onToggleSelect = vi.fn()
    const n = makeNotification()
    render(
      <NotificationRow
        notification={n}
        onRefresh={vi.fn()}
        selectable={true}
        selected={false}
        onToggleSelect={onToggleSelect}
      />,
    )
    await user.click(screen.getByTestId("notification-select-checkbox"))
    expect(onToggleSelect).toHaveBeenCalledWith("n1")
  })

  it("clicking the checkbox does NOT trigger row navigation (stopPropagation)", async () => {
    vi.mocked(markNotificationRead).mockClear()
    const user = userEvent.setup()
    const n = makeNotification({ readAt: null, linkPath: "/contacts/c1" })
    render(
      <NotificationRow
        notification={n}
        onRefresh={vi.fn()}
        selectable={true}
        selected={false}
        onToggleSelect={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId("notification-select-checkbox"))
    // stopPropagation prevents the row click from firing
    expect(markNotificationRead).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — selection state + bulk bar
// ---------------------------------------------------------------------------

describe("NotificationsPageClient — multi-select and bulk bar (E3)", () => {
  it("renders checkboxes on page rows (selectable=true is passed)", async () => {
    render(<NotificationsPageClient />)
    // Wait for items to load
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThan(0)
    })
  })

  it("bulk bar is hidden when no rows are selected", async () => {
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })
    expect(screen.queryByTestId("bulk-action-bar")).toBeNull()
  })

  it("selecting a row shows the bulk bar with '1 selected'", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThan(0)
    })
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument()
    expect(screen.getByTestId("bulk-selected-count").textContent).toContain("1 selected")
  })

  it("selecting two rows shows '2 selected'", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThanOrEqual(
        2,
      )
    })
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)
    await user.click(checkboxes[1]!)
    expect(screen.getByTestId("bulk-selected-count").textContent).toContain("2 selected")
  })

  it("'Clear selection' button empties the selection and hides the bar", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThan(0)
    })
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument()

    await user.click(screen.getByTestId("bulk-action-clear"))
    expect(screen.queryByTestId("bulk-action-bar")).toBeNull()
  })

  it("deselecting the only selected row hides the bar", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThan(0)
    })
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!) // select
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument()
    await user.click(checkboxes[0]!) // deselect
    expect(screen.queryByTestId("bulk-action-bar")).toBeNull()
  })

  it("'Mark read' button calls markNotificationsReadBulk with selected ids", async () => {
    vi.mocked(markNotificationsReadBulk).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThan(0)
    })
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)

    await user.click(screen.getByTestId("bulk-action-mark-read"))

    await waitFor(() => {
      expect(markNotificationsReadBulk).toHaveBeenCalledOnce()
    })
    const call = vi.mocked(markNotificationsReadBulk).mock.calls[0]![0]
    expect(call.ids).toContain("n1")
  })

  it("'Mark unread' button calls markNotificationsUnreadBulk with selected ids", async () => {
    vi.mocked(markNotificationsUnreadBulk).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThan(0)
    })
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)

    await user.click(screen.getByTestId("bulk-action-mark-unread"))

    await waitFor(() => {
      expect(markNotificationsUnreadBulk).toHaveBeenCalledOnce()
    })
    const call = vi.mocked(markNotificationsUnreadBulk).mock.calls[0]![0]
    expect(call.ids).toContain("n1")
  })

  it("'Archive' button calls archiveNotificationsBulk with selected ids", async () => {
    vi.mocked(archiveNotificationsBulk).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThan(0)
    })
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)

    await user.click(screen.getByTestId("bulk-action-archive"))

    await waitFor(() => {
      expect(archiveNotificationsBulk).toHaveBeenCalledOnce()
    })
    const call = vi.mocked(archiveNotificationsBulk).mock.calls[0]![0]
    expect(call.ids).toContain("n1")
  })

  it("snooze: clicking a preset calls snoozeNotificationsBulk with selected ids and an until date", async () => {
    vi.mocked(snoozeNotificationsBulk).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThan(0)
    })
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)

    // Open the snooze popover
    await user.click(screen.getByTestId("bulk-action-snooze"))
    const menu = await screen.findByTestId("bulk-snooze-menu")
    expect(menu).toBeInTheDocument()

    const before = Date.now()
    await user.click(screen.getByTestId("bulk-snooze-preset-later-today"))

    await waitFor(() => {
      expect(snoozeNotificationsBulk).toHaveBeenCalledOnce()
    })
    const call = vi.mocked(snoozeNotificationsBulk).mock.calls[0]![0] as {
      ids: string[]
      until: Date
    }
    expect(call.ids).toContain("n1")
    // ~3h from now
    const diffMs = call.until.getTime() - before
    expect(diffMs).toBeGreaterThanOrEqual(3 * 60 * 60 * 1000 - 5_000)
    expect(diffMs).toBeLessThanOrEqual(3 * 60 * 60 * 1000 + 5_000)
  })

  it("selection clears after a bulk action", async () => {
    vi.mocked(markNotificationsReadBulk).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThan(0)
    })
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument()

    await user.click(screen.getByTestId("bulk-action-mark-read"))

    await waitFor(() => {
      expect(screen.queryByTestId("bulk-action-bar")).toBeNull()
    })
  })
})
