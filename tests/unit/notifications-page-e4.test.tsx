/**
 * Unit tests for Section E4 — compact/dense view toggle on the /notifications page.
 *
 * Tests:
 *   - Default density is comfortable (body clamps to 2 lines)
 *   - Toggling to Compact clamps the body to 1 line (Gmail-style)
 *   - Toggling back to Comfortable restores the 2-line clamp
 *   - The preference is written to localStorage when the toggle is clicked
 *   - Setting pathway.notifications.density="compact" in localStorage causes rows
 *     to mount compact (body clamps to 1 line)
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
      body: "A preview line that density controls clamp to one or two lines.",
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
    body: "A preview line that density controls clamp to one or two lines.",
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

// Density's OBSERVABLE effect (LAW 7): the body preview clamps to ONE line in
// compact, TWO in comfortable. Assert the clamp, not a data attribute.
function expectAllBodiesClampTo(lines: 1 | 2): void {
  const want = lines === 1 ? "line-clamp-1" : "line-clamp-2"
  const notWant = lines === 1 ? "line-clamp-2" : "line-clamp-1"
  const bodies = screen.getAllByTestId("notification-body")
  expect(bodies.length).toBeGreaterThan(0)
  for (const b of bodies) {
    expect(b.className).toContain(want)
    expect(b.className).not.toContain(notWant)
  }
}

// ---------------------------------------------------------------------------
// NotificationRow — compact clamps the body preview
// ---------------------------------------------------------------------------

describe("NotificationRow — compact clamps the body preview (E4 / D3)", () => {
  it("clamps the body to TWO lines when compact is not passed", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("notification-body").className).toContain("line-clamp-2")
  })

  it("clamps the body to TWO lines when compact=false", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} compact={false} />)
    expect(screen.getByTestId("notification-body").className).toContain("line-clamp-2")
  })

  it("clamps the body to ONE line when compact=true", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} compact={true} />)
    const body = screen.getByTestId("notification-body")
    expect(body.className).toContain("line-clamp-1")
    expect(body.className).not.toContain("line-clamp-2")
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
  it("rows mount comfortable (body clamps to 2 lines) when localStorage is empty", async () => {
    render(<NotificationsPageClient />)
    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })
    // All rows should be comfortable
    expectAllBodiesClampTo(2)
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — toggling density
// ---------------------------------------------------------------------------

describe("NotificationsPageClient — toggling density (E4)", () => {
  it("clicking Compact clamps the rows' body to ONE line", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    await user.click(screen.getByTestId("density-compact"))

    expectAllBodiesClampTo(1)
  })

  it("clicking Comfortable after Compact restores the TWO-line clamp", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    // Switch to compact
    await user.click(screen.getByTestId("density-compact"))
    // Switch back to comfortable
    await user.click(screen.getByTestId("density-comfortable"))

    expectAllBodiesClampTo(2)
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

    expectAllBodiesClampTo(1)
  })

  it("falls back to comfortable when localStorage holds a corrupt value", async () => {
    localStorage.setItem("pathway.notifications.density", "corrupt-garbage")

    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    expectAllBodiesClampTo(2)
  })

  it("default is comfortable when localStorage is empty", async () => {
    // localStorage is cleared in beforeEach
    render(<NotificationsPageClient />)

    await waitFor(() => {
      expect(screen.queryAllByTestId("notification-row").length).toBeGreaterThan(0)
    })

    expectAllBodiesClampTo(2)
  })
})

// ---------------------------------------------------------------------------
// NotificationRow — bell dropdown stays comfortable (no compact prop)
// ---------------------------------------------------------------------------

describe("NotificationRow — bell dropdown stays comfortable (E4)", () => {
  it("NotificationRow without compact prop stays comfortable (body clamps to 2 lines)", () => {
    const n = makeNotification()
    // Simulate bell dropdown usage: no compact prop passed
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("notification-body").className).toContain("line-clamp-2")
  })
})
