/**
 * Unit tests for Section E4 — compact/dense view toggle on the /notifications page.
 *
 * Tests:
 *   - Default density is "comfortable" (rows have data-density="comfortable")
 *   - Toggling to Compact sets rows to data-density="compact"
 *   - Toggling back to Comfortable restores data-density="comfortable"
 *   - The preference is written to localStorage when the toggle is clicked
 *   - Setting pathway.notifications.density="compact" in localStorage causes rows
 *     to mount with data-density="compact"
 *   - Default is comfortable when localStorage is empty
 *   - The bell dropdown (NotificationRow without compact prop) stays comfortable
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

// Fetch stub for NotificationsPageClient — one notification
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
  ],
  unreadCount: 1,
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
  // Clear localStorage before each test for isolation
  localStorage.clear()
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
// NotificationRow — compact prop and data-density attribute
// ---------------------------------------------------------------------------

describe("NotificationRow — data-density attribute (E4)", () => {
  it("has data-density='comfortable' when compact is not passed", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("notification-row")).toHaveAttribute("data-density", "comfortable")
  })

  it("has data-density='comfortable' when compact=false", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} compact={false} />)
    expect(screen.getByTestId("notification-row")).toHaveAttribute("data-density", "comfortable")
  })

  it("has data-density='compact' when compact=true", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} compact={true} />)
    expect(screen.getByTestId("notification-row")).toHaveAttribute("data-density", "compact")
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — density toggle control
// ---------------------------------------------------------------------------

describe("NotificationsPageClient — density toggle visible (E4)", () => {
  it("renders the density toggle control", () => {
    render(<NotificationsPageClient />)
    expect(screen.getByTestId("density-toggle")).toBeInTheDocument()
  })

  it("renders 'Comfortable' and 'Compact' option buttons", () => {
    render(<NotificationsPageClient />)
    expect(screen.getByTestId("density-comfortable")).toBeInTheDocument()
    expect(screen.getByTestId("density-compact")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — default density is comfortable
// ---------------------------------------------------------------------------

describe("NotificationsPageClient — default density (E4)", () => {
  it("rows mount with data-density='comfortable' when localStorage is empty", async () => {
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })
    // All rows should be comfortable
    const rows = screen.getAllByTestId("notification-row")
    for (const row of rows) {
      expect(row).toHaveAttribute("data-density", "comfortable")
    }
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — toggling density
// ---------------------------------------------------------------------------

describe("NotificationsPageClient — toggling density (E4)", () => {
  it("clicking Compact sets rows to data-density='compact'", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    await user.click(screen.getByTestId("density-compact"))

    const rows = screen.getAllByTestId("notification-row")
    for (const row of rows) {
      expect(row).toHaveAttribute("data-density", "compact")
    }
  })

  it("clicking Comfortable after Compact restores data-density='comfortable'", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    // Switch to compact
    await user.click(screen.getByTestId("density-compact"))
    // Switch back to comfortable
    await user.click(screen.getByTestId("density-comfortable"))

    const rows = screen.getAllByTestId("notification-row")
    for (const row of rows) {
      expect(row).toHaveAttribute("data-density", "comfortable")
    }
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — localStorage persistence
// ---------------------------------------------------------------------------

describe("NotificationsPageClient — localStorage persistence (E4)", () => {
  it("clicking Compact writes 'compact' to localStorage", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await user.click(screen.getByTestId("density-compact"))

    expect(localStorage.getItem("pathway.notifications.density")).toBe("compact")
  })

  it("clicking Comfortable writes 'comfortable' to localStorage", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    // Start in compact
    await user.click(screen.getByTestId("density-compact"))
    // Switch back to comfortable
    await user.click(screen.getByTestId("density-comfortable"))

    expect(localStorage.getItem("pathway.notifications.density")).toBe("comfortable")
  })

  it("pre-seeding localStorage with 'compact' causes rows to mount compact", async () => {
    // Set the preference BEFORE rendering the component
    localStorage.setItem("pathway.notifications.density", "compact")

    render(<NotificationsPageClient />)

    // Wait for rows to load
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    const rows = screen.getAllByTestId("notification-row")
    for (const row of rows) {
      expect(row).toHaveAttribute("data-density", "compact")
    }
  })

  it("default is comfortable when localStorage is empty", async () => {
    // localStorage is cleared in beforeEach
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    const rows = screen.getAllByTestId("notification-row")
    for (const row of rows) {
      expect(row).toHaveAttribute("data-density", "comfortable")
    }
  })
})

// ---------------------------------------------------------------------------
// NotificationRow — bell dropdown stays comfortable (no compact prop)
// ---------------------------------------------------------------------------

describe("NotificationRow — bell dropdown stays comfortable (E4)", () => {
  it("NotificationRow without compact prop defaults to data-density='comfortable'", () => {
    const n = makeNotification()
    // Simulate bell dropdown usage: no compact prop passed
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("notification-row")).toHaveAttribute("data-density", "comfortable")
  })
})
