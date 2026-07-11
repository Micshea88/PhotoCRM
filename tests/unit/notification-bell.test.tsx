/**
 * Unit tests for the notification bell + row components (Task 15 / Section C).
 * Tests: bell badge shows/hides per count; row renders 3 layers + relative
 * time; create-task is disabled when contactId is null; snooze options
 * compute future `until` dates; snooze menu renders all presets + custom row;
 * choosing a preset calls snoozeNotification with the right `until`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
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

// Mock next/navigation — useRouter().push is captured for assertions
let mockRouterPush: ReturnType<typeof vi.fn>
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// Mock the server actions so they don't try to run in jsdom
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
}))

// Stub fetch for the dropdown/bell
vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ notifications: [], unreadCount: 0 }),
  }),
)

// Radix Popover requires pointer-event APIs that jsdom doesn't fully implement.
// Shim them so Radix's pointer-capture guard doesn't trip.
beforeEach(() => {
  // Reset the router push mock for each test
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

import { NotificationBell } from "@/modules/notifications/ui/notification-bell"
import {
  NotificationRow,
  relativeTime,
  SNOOZE_OPTIONS,
  formatSnoozeDate,
  toLocalDatetimeValue,
} from "@/modules/notifications/ui/notification-row"
import {
  markNotificationRead,
  markNotificationUnread,
  markNotificationsReadBulk,
  snoozeNotification,
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

  it("shows a blue dot when readAt is null (unread)", () => {
    const n = makeNotification({ readAt: null })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    const dot = screen.getByTestId("notification-read-dot")
    expect(dot).toBeInTheDocument()
    expect(dot.classList.contains("bg-blue-500")).toBe(true)
  })

  it("renders NO dot element when readAt is set (read)", () => {
    const n = makeNotification({ readAt: new Date() })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.queryByTestId("notification-read-dot")).toBeNull()
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
// Snooze option `computeUntil` — 4 new presets with fixed clock injection
// ---------------------------------------------------------------------------

describe("SNOOZE_OPTIONS computeUntil (fixed now = Tuesday 2026-07-07T10:00:00 UTC)", () => {
  // Fixed reference point: 2026-07-07T10:00:00Z, a Tuesday
  const fixedNow = new Date("2026-07-07T10:00:00Z")

  it("[0] 'Later today' produces exactly now + 3 hours", () => {
    const until = SNOOZE_OPTIONS[0]!.computeUntil(fixedNow)
    expect(until.getTime() - fixedNow.getTime()).toBe(3 * 60 * 60 * 1000)
  })

  it("[1] 'Tomorrow' is the next calendar day at 08:00 local time", () => {
    const until = SNOOZE_OPTIONS[1]!.computeUntil(fixedNow)
    expect(until.getTime()).toBeGreaterThan(fixedNow.getTime())
    // Should be one calendar day later
    const expectedDate = new Date(fixedNow)
    expectedDate.setDate(expectedDate.getDate() + 1)
    expect(until.getDate()).toBe(expectedDate.getDate())
    expect(until.getHours()).toBe(8)
    expect(until.getMinutes()).toBe(0)
    expect(until.getSeconds()).toBe(0)
  })

  it("[2] 'In 2 days' is 2 calendar days later at 08:00 local time", () => {
    const until = SNOOZE_OPTIONS[2]!.computeUntil(fixedNow)
    expect(until.getTime()).toBeGreaterThan(fixedNow.getTime())
    const expectedDate = new Date(fixedNow)
    expectedDate.setDate(expectedDate.getDate() + 2)
    expect(until.getDate()).toBe(expectedDate.getDate())
    expect(until.getHours()).toBe(8)
    expect(until.getMinutes()).toBe(0)
    expect(until.getSeconds()).toBe(0)
  })

  it("[3] 'Next week' is the next Monday at 08:00 local time (Tuesday → next Mon in 6 days)", () => {
    // July 7, 2026 is a Tuesday (getDay() === 2), so next Monday is July 13
    const until = SNOOZE_OPTIONS[3]!.computeUntil(fixedNow)
    expect(until.getTime()).toBeGreaterThan(fixedNow.getTime())
    expect(until.getDay()).toBe(1) // 1 === Monday
    expect(until.getHours()).toBe(8)
    expect(until.getMinutes()).toBe(0)
    expect(until.getSeconds()).toBe(0)
  })

  it("[3] 'Next week' always skips to next Monday even when today is Monday", () => {
    // Monday 2026-07-06 10:00 local time (month is 0-indexed, so 6 = July)
    const monday = new Date(2026, 6, 6, 10, 0, 0)
    const until = SNOOZE_OPTIONS[3]!.computeUntil(monday)
    // Should be next Monday (+7 days), not today
    expect(until.getDay()).toBe(1)
    expect(until.getTime()).toBeGreaterThan(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
  })
})

// ---------------------------------------------------------------------------
// formatSnoozeDate helper
// ---------------------------------------------------------------------------

describe("formatSnoozeDate", () => {
  it("returns only time when the target date is today", () => {
    const now = new Date("2026-07-08T14:00:00")
    const sameDay = new Date("2026-07-08T17:00:00")
    const result = formatSnoozeDate(sameDay, now)
    // Should NOT contain a weekday or month name — just a time
    expect(result).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/)
    // Should contain some time-like output (hour)
    expect(result).toBeTruthy()
  })

  it("returns weekday + date when target is a different day", () => {
    const now = new Date("2026-07-08T14:00:00")
    const tomorrow = new Date("2026-07-09T08:00:00")
    const result = formatSnoozeDate(tomorrow, now)
    // The result should contain a weekday abbreviation
    expect(result).toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/)
  })
})

// ---------------------------------------------------------------------------
// toLocalDatetimeValue helper
// ---------------------------------------------------------------------------

describe("toLocalDatetimeValue", () => {
  it("formats a local Date as YYYY-MM-DDTHH:mm without UTC conversion", () => {
    // Construct with local-time arguments so the result is deterministic regardless of TZ
    const d = new Date(2026, 6, 15, 9, 5, 0) // July 15 2026 09:05:00 local
    expect(toLocalDatetimeValue(d)).toBe("2026-07-15T09:05")
  })

  it("zero-pads month, day, hour, and minute", () => {
    const d = new Date(2026, 0, 3, 8, 4, 0) // Jan 3 2026 08:04:00 local
    expect(toLocalDatetimeValue(d)).toBe("2026-01-03T08:04")
  })
})

// ---------------------------------------------------------------------------
// Snooze menu component test (jsdom) — all 4 presets + custom row rendered;
// clicking a preset calls snoozeNotification with the expected until
// ---------------------------------------------------------------------------

describe("NotificationRow — snooze menu", () => {
  it("renders the snooze trigger button", () => {
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    expect(screen.getByTestId("action-snooze")).toBeInTheDocument()
  })

  it("opens the snooze menu with all 4 presets + custom row on trigger click", async () => {
    const user = userEvent.setup()
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)

    await user.click(screen.getByTestId("action-snooze"))

    // Radix Portal renders to document.body — check body or use findBy*
    const menu = await screen.findByTestId("snooze-menu")
    expect(menu).toBeInTheDocument()

    // All 4 presets
    expect(screen.getByTestId("snooze-preset-later-today")).toBeInTheDocument()
    expect(screen.getByTestId("snooze-preset-tomorrow")).toBeInTheDocument()
    expect(screen.getByTestId("snooze-preset-in-2-days")).toBeInTheDocument()
    expect(screen.getByTestId("snooze-preset-next-week")).toBeInTheDocument()

    // Custom row
    expect(screen.getByTestId("snooze-custom-row")).toBeInTheDocument()
    expect(screen.getByTestId("snooze-custom-input")).toBeInTheDocument()
  })

  it("each preset button shows its label text", async () => {
    const user = userEvent.setup()
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    await user.click(screen.getByTestId("action-snooze"))
    await screen.findByTestId("snooze-menu")

    expect(screen.getByTestId("snooze-preset-later-today").textContent).toContain("Later today")
    expect(screen.getByTestId("snooze-preset-tomorrow").textContent).toContain("Tomorrow")
    expect(screen.getByTestId("snooze-preset-in-2-days").textContent).toContain("In 2 days")
    expect(screen.getByTestId("snooze-preset-next-week").textContent).toContain("Next week")
  })

  it("clicking 'Later today' preset calls snoozeNotification with until ~3h from now", async () => {
    vi.mocked(snoozeNotification).mockClear()
    const user = userEvent.setup()
    const n = makeNotification()
    const before = Date.now()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    await user.click(screen.getByTestId("action-snooze"))
    await screen.findByTestId("snooze-menu")

    await user.click(screen.getByTestId("snooze-preset-later-today"))

    await waitFor(() => {
      expect(snoozeNotification).toHaveBeenCalledOnce()
    })
    const call = vi.mocked(snoozeNotification).mock.calls[0]![0] as { id: string; until: Date }
    expect(call.id).toBe("n1")
    const diffMs = call.until.getTime() - before
    // Should be ~3h: 3h ± 5s tolerance
    expect(diffMs).toBeGreaterThanOrEqual(3 * 60 * 60 * 1000 - 5_000)
    expect(diffMs).toBeLessThanOrEqual(3 * 60 * 60 * 1000 + 5_000)
  })

  it("clicking 'Tomorrow' preset calls snoozeNotification with until at 08:00 next day", async () => {
    vi.mocked(snoozeNotification).mockClear()
    const user = userEvent.setup()
    const n = makeNotification()
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    await user.click(screen.getByTestId("action-snooze"))
    await screen.findByTestId("snooze-menu")

    await user.click(screen.getByTestId("snooze-preset-tomorrow"))

    await waitFor(() => {
      expect(snoozeNotification).toHaveBeenCalledOnce()
    })
    const call = vi.mocked(snoozeNotification).mock.calls[0]![0] as { id: string; until: Date }
    expect(call.until.getHours()).toBe(8)
    expect(call.until.getMinutes()).toBe(0)
    expect(call.until.getSeconds()).toBe(0)
    // Must be in the future
    expect(call.until.getTime()).toBeGreaterThan(Date.now())
  })
})

// ---------------------------------------------------------------------------
// D2 — Row click navigation
// ---------------------------------------------------------------------------

describe("NotificationRow — row click navigation (D2)", () => {
  it("clicking the row calls markNotificationRead and router.push(linkPath) when unread + linkPath set", async () => {
    vi.mocked(markNotificationRead).mockClear()
    const user = userEvent.setup()
    const n = makeNotification({ readAt: null, linkPath: "/contacts/c1" })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    await user.click(screen.getByTestId("notification-row"))
    await waitFor(() => {
      expect(markNotificationRead).toHaveBeenCalledWith({ id: "n1" })
    })
    expect(mockRouterPush).toHaveBeenCalledWith("/contacts/c1")
  })

  it("clicking the row marks read but does NOT push when linkPath is null", async () => {
    vi.mocked(markNotificationRead).mockClear()
    const user = userEvent.setup()
    const n = makeNotification({ readAt: null, linkPath: null })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    await user.click(screen.getByTestId("notification-row"))
    await waitFor(() => {
      expect(markNotificationRead).toHaveBeenCalledWith({ id: "n1" })
    })
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it("clicking a hover cluster action (archive) does NOT navigate the row (stopPropagation)", async () => {
    const user = userEvent.setup()
    const n = makeNotification({ readAt: null, linkPath: "/contacts/c1" })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)
    await user.click(screen.getByTestId("action-archive"))
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  // STEP 2 — persistent (always-visible) read/unread toggle
  it("STEP 2: the read toggle is present WITHOUT hovering + state-dependent label", () => {
    render(<NotificationRow notification={makeNotification({ readAt: null })} onRefresh={vi.fn()} />)
    // Queried directly (no hover): unread → 'Mark as read'.
    expect(screen.getByTestId("row-read-toggle")).toHaveAttribute("aria-label", "Mark as read")

    // A read row → 'Mark as unread'.
    render(
      <NotificationRow notification={makeNotification({ readAt: new Date() })} onRefresh={vi.fn()} />,
    )
    expect(screen.getAllByTestId("row-read-toggle")[1]).toHaveAttribute(
      "aria-label",
      "Mark as unread",
    )
  })

  it("STEP 2: clicking the toggle flips the row read-state + dot in lockstep, and reverses", async () => {
    vi.mocked(markNotificationRead).mockClear()
    vi.mocked(markNotificationUnread).mockClear()
    const user = userEvent.setup()
    const n = makeNotification({ readAt: null, linkPath: "/contacts/c1" })
    render(<NotificationRow notification={n} onRefresh={vi.fn()} />)

    // Unread: dot present, toggle says 'Mark as read'.
    expect(screen.getByTestId("notification-read-dot")).toBeInTheDocument()
    await user.click(screen.getByTestId("row-read-toggle"))

    // Flipped to read: action fired, dot gone, label flipped — no navigation.
    expect(markNotificationRead).toHaveBeenCalledWith({ id: "n1" })
    expect(screen.queryByTestId("notification-read-dot")).toBeNull()
    expect(screen.getByTestId("row-read-toggle")).toHaveAttribute("aria-label", "Mark as unread")
    expect(mockRouterPush).not.toHaveBeenCalled()

    // Click again → reverses to unread.
    await user.click(screen.getByTestId("row-read-toggle"))
    expect(markNotificationUnread).toHaveBeenCalledWith({ id: "n1" })
    const dot = screen.getByTestId("notification-read-dot")
    expect(dot.classList.contains("bg-blue-500")).toBe(true)
    expect(screen.getByTestId("row-read-toggle")).toHaveAttribute("aria-label", "Mark as read")
  })
})

// ---------------------------------------------------------------------------
// STEP 3 — unified state-driven "mark all" toggle (one button, visible set)
// ---------------------------------------------------------------------------

describe("NotificationDropdown — unified mark-all toggle (STEP 3)", () => {
  it("reads 'Mark all read' when the visible set has unread, and marks the visible ids read", async () => {
    vi.mocked(markNotificationsReadBulk).mockClear()
    // Dropdown fetch returns one UNREAD notification.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            notifications: [makeNotification({ id: "d1", readAt: null })],
            unreadCount: 1,
          }),
      }),
    )
    const user = userEvent.setup()
    render(<NotificationBell initialUnreadCount={1} />)
    await user.click(screen.getByTestId("notification-bell"))

    const toggle = await screen.findByTestId("mark-all-toggle")
    // Only ONE mark-all control (the old two-button pattern is gone).
    expect(screen.queryByTestId("mark-all-read")).toBeNull()
    expect(screen.queryByTestId("mark-all-unread")).toBeNull()
    expect(toggle).toHaveTextContent("Mark all read")

    await user.click(toggle)
    // Acts on the VISIBLE ids via the bulk action.
    await waitFor(() => {
      expect(markNotificationsReadBulk).toHaveBeenCalledWith({ ids: ["d1"] })
    })
  })

  it("reads 'Mark all unread' when the visible set is all read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            notifications: [makeNotification({ id: "d1", readAt: new Date() })],
            unreadCount: 0,
          }),
      }),
    )
    const user = userEvent.setup()
    render(<NotificationBell initialUnreadCount={0} />)
    await user.click(screen.getByTestId("notification-bell"))
    const toggle = await screen.findByTestId("mark-all-toggle")
    expect(toggle).toHaveTextContent("Mark all unread")
  })
})
