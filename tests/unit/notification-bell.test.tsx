/**
 * Unit tests for the notification bell + row components (Task 15).
 * Tests: bell badge shows/hides per count; row renders 3 layers + relative
 * time; create-task is disabled when contactId is null; snooze options
 * compute future `until` dates.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock next/link so it renders as a plain <a>
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

// Mock the server actions so they don't try to run in jsdom
vi.mock("@/modules/notifications/actions", () => ({
  markNotificationRead: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  markNotificationUnread: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  archiveNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  snoozeNotification: vi.fn().mockResolvedValue({ data: { id: "n1" } }),
  createTaskFromNotification: vi.fn().mockResolvedValue({ data: { taskId: "t1" } }),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ data: { count: 0 } }),
}))

// Stub fetch for the dropdown/bell
vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ notifications: [], unreadCount: 0 }),
  }),
)

import { NotificationBell } from "@/modules/notifications/ui/notification-bell"
import {
  NotificationRow,
  relativeTime,
  SNOOZE_OPTIONS,
} from "@/modules/notifications/ui/notification-row"
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
    body: "The delivery failed because the mailbox does not exist.",
    linkPath: null,
    contactId: "c1",
    payload: null,
    sourceModule: "email",
    readAt: null,
    archivedAt: null,
    snoozedUntil: null,
    scheduledFor: null,
    emailSentAt: null,
    createdAt: new Date("2026-07-07T10:00:00Z"),
    updatedAt: new Date("2026-07-07T10:00:00Z"),
    contactName: "Jane Smith",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Bell badge
// ---------------------------------------------------------------------------

describe("NotificationBell", () => {
  it("hides the badge when unreadCount is 0", () => {
    render(<NotificationBell initialUnreadCount={0} />)
    expect(screen.queryByTestId("notification-badge")).toBeNull()
  })

  it("shows the badge with the correct count when > 0", () => {
    render(<NotificationBell initialUnreadCount={3} />)
    const badge = screen.getByTestId("notification-badge")
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toBe("3")
  })

  it("shows '9+' when unreadCount > 9", () => {
    render(<NotificationBell initialUnreadCount={42} />)
    const badge = screen.getByTestId("notification-badge")
    expect(badge.textContent).toBe("9+")
  })

  it("renders the bell button", () => {
    render(<NotificationBell initialUnreadCount={0} />)
    expect(screen.getByTestId("notification-bell")).toBeInTheDocument()
  })

  it("opens the dropdown on click", async () => {
    const user = userEvent.setup()
    render(<NotificationBell initialUnreadCount={1} />)
    await user.click(screen.getByTestId("notification-bell"))
    // The dropdown is mounted
    expect(screen.getByTestId("notification-dropdown")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Notification row — 3 layers
// ---------------------------------------------------------------------------

describe("NotificationRow", () => {
  it("renders the headline (title) in layer 1", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("notification-title").textContent).toContain(n.title)
  })

  it("renders the body in layer 2", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("notification-body").textContent).toBe(n.body)
  })

  it("renders the contact name as anchor in layer 3 when contactName is present", () => {
    const n = makeNotification({ contactName: "Jane Smith" })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("notification-anchor").textContent).toContain("Jane Smith")
  })

  it("renders type label as anchor in layer 3 when contactName is null", () => {
    const n = makeNotification({ contactName: null, contactId: null })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    // The type label for "email.bounced" is "Email bounced"
    expect(screen.getByTestId("notification-anchor").textContent).toContain("Email bounced")
  })

  it("renders relative time in layer 3", () => {
    // Use a fixed createdAt so the component renders a deterministic string.
    // relativeTime() is unit-tested separately; here we just confirm the row
    // wires the field through to the DOM (rendered value will be "Xm/h/d ago"
    // or a date, depending on when the test runs — assert it's non-empty).
    const n = makeNotification({ createdAt: new Date("2026-07-07T10:00:00Z") })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    const timeEl = screen.getByTestId("notification-time")
    expect(timeEl.textContent).not.toBe("")
  })

  it("shows unread dot when readAt is null", () => {
    const n = makeNotification({ readAt: null })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    const dot = screen.getByTestId("notification-read-dot")
    expect(dot).toBeInTheDocument()
    expect(dot.getAttribute("aria-label")).toBe("Unread")
  })

  it("shows read indicator when readAt is set", () => {
    const n = makeNotification({ readAt: new Date() })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("notification-read-dot").getAttribute("aria-label")).toBe("Read")
  })
})

// ---------------------------------------------------------------------------
// Create-task disabled when contactId is null
// ---------------------------------------------------------------------------

describe("NotificationRow — create-task action", () => {
  it("is enabled when contactId is present", () => {
    const n = makeNotification({ contactId: "c1" })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    const btn = screen.getByTestId("action-create-task")
    expect(btn).not.toBeDisabled()
    expect(btn.getAttribute("aria-disabled")).toBe("false")
  })

  it("is disabled when contactId is null", () => {
    const n = makeNotification({ contactId: null })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    const btn = screen.getByTestId("action-create-task")
    expect(btn).toBeDisabled()
    expect(btn.getAttribute("aria-disabled")).toBe("true")
  })
})

// ---------------------------------------------------------------------------
// relativeTime helper
// ---------------------------------------------------------------------------

describe("relativeTime", () => {
  const NOW = new Date("2026-07-07T12:00:00Z")

  it("returns 'just now' for < 1 minute ago", () => {
    expect(relativeTime(new Date("2026-07-07T11:59:30Z"), NOW)).toBe("just now")
  })

  it("returns Xm ago for < 1 hour", () => {
    expect(relativeTime(new Date("2026-07-07T11:30:00Z"), NOW)).toBe("30m ago")
  })

  it("returns Xh ago for < 24 hours", () => {
    expect(relativeTime(new Date("2026-07-07T06:00:00Z"), NOW)).toBe("6h ago")
  })

  it("returns Xd ago for < 7 days", () => {
    expect(relativeTime(new Date("2026-07-04T12:00:00Z"), NOW)).toBe("3d ago")
  })

  it("returns formatted date for >= 7 days", () => {
    const result = relativeTime(new Date("2026-06-01T12:00:00Z"), NOW)
    // Should include month and day
    expect(result).toMatch(/Jun.+1/)
  })
})

// ---------------------------------------------------------------------------
// Snooze — future `until` computation (calls production SNOOZE_OPTIONS)
// ---------------------------------------------------------------------------

describe("Snooze option `until` computation", () => {
  // Fixed reference point: 2026-07-07T10:00:00Z, a Tuesday
  const fixedNow = new Date("2026-07-07T10:00:00Z")

  it("SNOOZE_OPTIONS[0] '1 hour' computes a date exactly 60 min in the future", () => {
     
    const until = SNOOZE_OPTIONS[0]!.computeUntil(fixedNow)
    expect(until.getTime() - fixedNow.getTime()).toBe(3_600_000)
    expect(until.getTime()).toBeGreaterThan(fixedNow.getTime())
  })

  it("SNOOZE_OPTIONS[1] 'Tomorrow' produces next-calendar-day at 09:00 local time", () => {
     
    const until = SNOOZE_OPTIONS[1]!.computeUntil(fixedNow)
    expect(until.getTime()).toBeGreaterThan(fixedNow.getTime())
    expect(until.getHours()).toBe(9)
    expect(until.getMinutes()).toBe(0)
    expect(until.getSeconds()).toBe(0)
  })

  it("SNOOZE_OPTIONS[2] 'Next week' computes the coming Monday at 09:00 local time", () => {
    // July 7, 2026 is a Tuesday (getDay() === 2), so next Monday is July 13
     
    const until = SNOOZE_OPTIONS[2]!.computeUntil(fixedNow)
    expect(until.getTime()).toBeGreaterThan(fixedNow.getTime())
    expect(until.getDay()).toBe(1) // 1 === Monday
    expect(until.getHours()).toBe(9)
    expect(until.getMinutes()).toBe(0)
  })
})
