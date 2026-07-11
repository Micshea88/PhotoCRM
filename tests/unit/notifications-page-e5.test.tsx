/**
 * Unit tests for Section E5 — archive undo window + un-archive on
 * notifications-page-client.tsx and notification-row.tsx.
 *
 * Tests:
 *   - Archiving a single row shows the undo snackbar ("Archived 1 notification · Undo")
 *   - Bulk archiving shows the snackbar with the right count ("Archived N notifications · Undo")
 *   - Clicking Undo invokes unarchiveNotification / unarchiveNotificationsBulk with captured ids
 *   - Clicking Undo dismisses the snackbar
 *   - The snackbar auto-dismisses after ~6 s (fake timers)
 *   - Dismissing the snackbar manually hides it
 *   - Archive-tab rows show the "Unarchive" affordance (action-unarchive)
 *   - Non-archive-tab rows do NOT show the affordance (onUnarchive not passed)
 *   - Clicking "Unarchive" button invokes unarchiveNotification with the row's id
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react"
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
  unarchiveNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  unarchiveNotificationsBulk: vi.fn().mockResolvedValue({ data: { count: 1 } }),
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

// Fetch stub for NotificationsPageClient — two notifications
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

// Always restore real timers after each test — prevents fake timers from
// leaking into subsequent tests if a test times out or throws.
afterEach(() => {
  vi.useRealTimers()
})

import { NotificationsPageClient } from "@/modules/notifications/ui/notifications-page-client"
import { NotificationRow } from "@/modules/notifications/ui/notification-row"
import {
  archiveNotification,
  unarchiveNotification,
  unarchiveNotificationsBulk,
  archiveNotificationsBulk,
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
// NotificationRow — onUnarchive affordance
// ---------------------------------------------------------------------------

describe("NotificationRow — Unarchive affordance (E5)", () => {
  it("does NOT render an Unarchive button when onUnarchive is not provided", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.queryByTestId("action-unarchive")).toBeNull()
  })

  it("renders an Unarchive button when onUnarchive is provided", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} onUnarchive={vi.fn()} />)
    expect(screen.getByTestId("action-unarchive")).toBeInTheDocument()
  })

  it("clicking Unarchive calls onUnarchive", async () => {
    const user = userEvent.setup()
    const onUnarchive = vi.fn()
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} onUnarchive={onUnarchive} />)
    await user.click(screen.getByTestId("action-unarchive"))
    expect(onUnarchive).toHaveBeenCalledOnce()
  })

  it("on the Archive tab (onUnarchive set), hides the Archive + Snooze buttons (no re-archive)", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} onUnarchive={vi.fn()} />)
    // Unarchive is offered; the redundant re-archive + snooze are gone.
    expect(screen.getByTestId("action-unarchive")).toBeInTheDocument()
    expect(screen.queryByTestId("action-archive")).toBeNull()
    expect(screen.queryByTestId("action-snooze")).toBeNull()
  })

  it("off the Archive tab (no onUnarchive), the Archive + Snooze buttons are present", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("action-archive")).toBeInTheDocument()
    expect(screen.getByTestId("action-snooze")).toBeInTheDocument()
    expect(screen.queryByTestId("action-unarchive")).toBeNull()
  })

  it("on the Snoozed tab (onUnsnooze set), hides the redundant Snooze button (Wake now instead)", () => {
    const n = makeNotification({ snoozedUntil: new Date("2026-08-01T08:00:00Z") })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} onUnsnooze={vi.fn()} />)
    expect(screen.getByTestId("action-unsnooze")).toBeInTheDocument()
    expect(screen.queryByTestId("action-snooze")).toBeNull()
    // Archive stays available on the snoozed tab.
    expect(screen.getByTestId("action-archive")).toBeInTheDocument()
  })

  it("Archive button calls archiveNotification and then onArchived with the row id", async () => {
    vi.mocked(archiveNotification).mockClear()
    const user = userEvent.setup()
    const onArchived = vi.fn()
    const n = makeNotification({ id: "n-abc" })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} onArchived={onArchived} />)
    // Archive button is in the hover actions area
    await user.click(screen.getByTestId("action-archive"))
    await waitFor(() => {
      expect(archiveNotification).toHaveBeenCalledWith({ id: "n-abc" })
    })
    expect(onArchived).toHaveBeenCalledWith(["n-abc"])
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — undo snackbar (E5)
// ---------------------------------------------------------------------------

describe("NotificationsPageClient — undo snackbar after single-row archive (E5)", () => {
  it("archiving a single row shows the undo snackbar with '1 notification'", async () => {
    vi.mocked(archiveNotification).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    // Wait for rows to load
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    // Snackbar is not visible initially
    expect(screen.queryByTestId("undo-snackbar")).toBeNull()

    // Click the archive button on the first row
    await user.click(screen.getAllByTestId("action-archive")[0]!)

    await waitFor(() => {
      expect(screen.getByTestId("undo-snackbar")).toBeInTheDocument()
    })
    expect(screen.getByTestId("undo-snackbar").textContent).toContain("Archived 1 notification")
    // Should NOT say "notifications" (plural) for a single item
    expect(screen.getByTestId("undo-snackbar").textContent).not.toContain("notifications ")
  })
})

describe("NotificationsPageClient — undo snackbar after bulk archive (E5)", () => {
  it("bulk archiving 2 rows shows the snackbar with '2 notifications'", async () => {
    vi.mocked(archiveNotificationsBulk).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThanOrEqual(
        2,
      )
    })

    // Select both rows
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)
    await user.click(checkboxes[1]!)

    // Click bulk archive
    await user.click(screen.getByTestId("bulk-action-archive"))

    await waitFor(() => {
      expect(screen.getByTestId("undo-snackbar")).toBeInTheDocument()
    })
    expect(screen.getByTestId("undo-snackbar").textContent).toContain("Archived 2 notifications")
  })

  it("clicking Undo invokes unarchiveNotificationsBulk with the captured ids and dismisses the snackbar", async () => {
    vi.mocked(archiveNotificationsBulk).mockClear()
    vi.mocked(unarchiveNotificationsBulk).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThanOrEqual(
        2,
      )
    })

    // Select both rows
    const checkboxes = screen.getAllByTestId("notification-select-checkbox")
    await user.click(checkboxes[0]!)
    await user.click(checkboxes[1]!)

    // Bulk archive
    await user.click(screen.getByTestId("bulk-action-archive"))

    await waitFor(() => {
      expect(screen.getByTestId("undo-snackbar")).toBeInTheDocument()
    })

    // Click Undo
    await user.click(screen.getByTestId("undo-snackbar-btn"))

    await waitFor(() => {
      expect(unarchiveNotificationsBulk).toHaveBeenCalledOnce()
    })
    const call = vi.mocked(unarchiveNotificationsBulk).mock.calls[0]![0]
    expect(call.ids).toContain("n1")
    expect(call.ids).toContain("n2")

    // Snackbar should be gone
    await waitFor(() => {
      expect(screen.queryByTestId("undo-snackbar")).toBeNull()
    })
  })

  it("clicking Undo on a single-item archive invokes unarchiveNotification (not bulk)", async () => {
    vi.mocked(archiveNotification).mockClear()
    vi.mocked(unarchiveNotification).mockClear()
    vi.mocked(unarchiveNotificationsBulk).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    // Archive a single row via the hover button
    await user.click(screen.getAllByTestId("action-archive")[0]!)

    await waitFor(() => {
      expect(screen.getByTestId("undo-snackbar")).toBeInTheDocument()
    })

    // Click Undo
    await user.click(screen.getByTestId("undo-snackbar-btn"))

    await waitFor(() => {
      expect(unarchiveNotification).toHaveBeenCalledOnce()
    })
    // unarchiveNotificationsBulk should NOT have been called
    expect(unarchiveNotificationsBulk).not.toHaveBeenCalled()

    // Snackbar should be gone
    await waitFor(() => {
      expect(screen.queryByTestId("undo-snackbar")).toBeNull()
    })
  })

  it("snackbar auto-dismisses after ~6 seconds (fake timers)", async () => {
    // Strategy: render and wait for the page to load with REAL timers, then
    // switch to fake timers right before the archive action so the snackbar's
    // auto-dismiss setTimeout is captured as a fake timer. This avoids the
    // well-known issue of waitFor hanging when fake timers are active at
    // render time (waitFor uses setTimeout for retry polling).
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    // Wait for rows to load (real timers)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThanOrEqual(
        1,
      )
    })

    // Select a row (real timers)
    await user.click(screen.getAllByTestId("notification-select-checkbox")[0]!)

    // NOW switch to fake timers — the upcoming showUndoSnackbar's setTimeout
    // will be registered as a fake timer.
    vi.useFakeTimers()

    // Click archive with fireEvent (synchronous, avoids userEvent timer internals)
    fireEvent.click(screen.getByTestId("bulk-action-archive"))

    // Flush microtasks so the mock Promise resolves and setUndoIds is called
    await act(async () => {
      await Promise.resolve()
    })

    // Snackbar should be visible
    expect(screen.getByTestId("undo-snackbar")).toBeInTheDocument()

    // Advance 6 seconds + 1ms — the auto-dismiss timer fires
    act(() => {
      vi.advanceTimersByTime(6_001)
    })

    // Snackbar is gone (synchronous state update after timer fires)
    expect(screen.queryByTestId("undo-snackbar")).toBeNull()
  })

  it("manually dismissing the snackbar hides it", async () => {
    vi.mocked(archiveNotificationsBulk).mockClear()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-select-checkbox").length).toBeGreaterThanOrEqual(
        1,
      )
    })

    await user.click(screen.getAllByTestId("notification-select-checkbox")[0]!)
    await user.click(screen.getByTestId("bulk-action-archive"))

    await waitFor(() => {
      expect(screen.getByTestId("undo-snackbar")).toBeInTheDocument()
    })

    // Click dismiss button
    await user.click(screen.getByTestId("undo-snackbar-dismiss"))

    await waitFor(() => {
      expect(screen.queryByTestId("undo-snackbar")).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — Archive tab shows Unarchive affordance (E5)
// ---------------------------------------------------------------------------

// Helper to re-stub fetch with a different response for archive-tab tests.
// Uses the same vi.stubGlobal pattern as the module-level stub above so the
// mock is a vi.fn() and can be replaced with mockResolvedValue.
function stubFetchWithArchived() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          notifications: [
            {
              ...FETCH_RESPONSE.notifications[0],
              archivedAt: new Date("2026-07-07T11:00:00Z").toISOString(),
            },
          ],
          unreadCount: 0,
          notificationContacts: [],
        }),
    }),
  )
}

function stubFetchDefault() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FETCH_RESPONSE),
    }),
  )
}

describe("NotificationsPageClient — Archive tab Unarchive affordance (E5)", () => {
  it("archive-tab rows show the Unarchive button", async () => {
    stubFetchWithArchived()
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    // Switch to the Archive tab
    await user.click(screen.getByTestId("page-tab-archive"))

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    // The Unarchive button should be present on archive-tab rows
    expect(screen.getByTestId("action-unarchive")).toBeInTheDocument()
  })

  it("non-archive tabs do NOT show the Unarchive button", async () => {
    stubFetchDefault()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    // "All" tab (default) — no Unarchive button
    expect(screen.queryByTestId("action-unarchive")).toBeNull()
  })

  it("clicking Unarchive on an archive-tab row invokes unarchiveNotification", async () => {
    vi.mocked(unarchiveNotification).mockClear()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            notifications: [
              {
                ...FETCH_RESPONSE.notifications[0]!,
                id: "n1",
                archivedAt: new Date("2026-07-07T11:00:00Z").toISOString(),
              },
            ],
            unreadCount: 0,
            notificationContacts: [],
          }),
      }),
    )

    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    // Switch to Archive tab
    await user.click(screen.getByTestId("page-tab-archive"))

    await waitFor(() => {
      expect(screen.getByTestId("action-unarchive")).toBeInTheDocument()
    })

    await user.click(screen.getByTestId("action-unarchive"))

    await waitFor(() => {
      expect(unarchiveNotification).toHaveBeenCalledWith({ id: "n1" })
    })
  })
})
