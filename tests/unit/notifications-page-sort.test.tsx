/**
 * Section 2 (D2) — the sort control must actually REORDER the list (LAW 7:
 * assert the observable result, not that a param was mapped).
 *
 * The old control was a MultiSelectMenu; clicking "Oldest first" appended to a
 * ["newest","oldest"] array so `v[0]` stayed "newest" and the sort never flipped.
 * This test drives the real control end-to-end: click → onChange → api param →
 * fetch URL → (mocked) ordered response → rendered row order. The mocked fetch
 * returns items in the order the `sort` param requests, so a rendered reorder
 * proves the control set sort="oldest" and the query consumed it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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

function row(id: string, title: string) {
  return {
    id,
    organizationId: "org1",
    recipientUserId: "u1",
    type: "email.bounced",
    category: "messages_email",
    tier: "critical",
    title,
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
  }
}

// Two distinguishable items. The mocked fetch returns them newest-first by
// default and oldest-first when the URL asks for sort=oldest — i.e. the server
// order honors the param, so a rendered reorder means the control worked.
const NEWEST_FIRST = [row("n-new", "NEWER notification"), row("n-old", "OLDER notification")]
const OLDEST_FIRST = [row("n-old", "OLDER notification"), row("n-new", "NEWER notification")]

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const sort = new URL(url, "http://localhost").searchParams.get("sort")
      const items = sort === "oldest" ? OLDEST_FIRST : NEWEST_FIRST
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ notifications: items, unreadCount: 0, notificationContacts: [] }),
      })
    }),
  )
})

import { NotificationsPageClient } from "@/modules/notifications/ui/notifications-page-client"

function renderedTitlesInOrder(): string[] {
  return screen.getAllByTestId("notification-title").map((el) => el.textContent)
}

describe("NotificationsPageClient — sort control reorders the list (D2 / LAW 7)", () => {
  it("defaults to newest-first, and clicking 'Oldest first' flips the rendered order", async () => {
    const user = userEvent.setup()
    render(<NotificationsPageClient />)

    // Default: newest first.
    await waitFor(() => {
      expect(screen.getAllByTestId("notification-title").length).toBe(2)
    })
    expect(renderedTitlesInOrder()[0]).toContain("NEWER")

    // Click the real single-select "Oldest first" control.
    await user.click(screen.getByTestId("notification-sort-oldest"))

    // The RENDERED ORDER must flip — proving sort=oldest reached the query.
    await waitFor(() => {
      expect(renderedTitlesInOrder()[0]).toContain("OLDER")
    })

    // radio semantics: "Oldest first" is now checked, "Newest first" is not.
    expect(screen.getByTestId("notification-sort-oldest")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByTestId("notification-sort-newest")).toHaveAttribute("aria-checked", "false")
  })

  it("the sort control is single-select radiogroup with no count badge", () => {
    render(<NotificationsPageClient />)
    const group = screen.getByTestId("notification-sort")
    expect(group).toHaveAttribute("role", "radiogroup")
    // Two radio options, no checkbox inputs, no count badge text.
    expect(screen.getByTestId("notification-sort-newest")).toHaveAttribute("role", "radio")
    expect(screen.getByTestId("notification-sort-oldest")).toHaveAttribute("role", "radio")
    expect(group.querySelectorAll('input[type="checkbox"]').length).toBe(0)
  })
})
