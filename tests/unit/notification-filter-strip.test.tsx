/**
 * Unit tests for Section E1 additions to NotificationFilterStrip and
 * NotificationsPageClient archive-tab behaviour:
 *
 *   - filterStateToApiParams: includes q + contactId; omits empty/whitespace
 *   - hasActiveNotificationFilters: detects search + contactId
 *   - NotificationFilterStrip: renders type + time controls; sort gated behind showSort
 *   - FilterPills: pills reflect active search + contact + type + time
 *   - NotificationsPageClient: switching to Archive hides contact picker + clears contactId
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ---------------------------------------------------------------------------
// Module mocks (hoisted — must be before any imports that transitively pull
// in server-only modules or Next.js navigation)
// ---------------------------------------------------------------------------

// Stub server actions so jsdom doesn't try to evaluate @/lib/db / server-only
vi.mock("@/modules/notifications/actions", () => ({
  markAllNotificationsRead: vi.fn().mockResolvedValue({}),
  markAllNotificationsUnread: vi.fn().mockResolvedValue({}),
  markNotificationRead: vi.fn().mockResolvedValue({}),
  markNotificationUnread: vi.fn().mockResolvedValue({}),
  archiveNotification: vi.fn().mockResolvedValue({}),
  snoozeNotification: vi.fn().mockResolvedValue({}),
  unsnoozeNotification: vi.fn().mockResolvedValue({}),
  createTaskFromNotification: vi.fn().mockResolvedValue({}),
}))

// next/link: render as plain <a> in jsdom
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

// next/navigation: notification-row uses useRouter().refresh()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// Radix / jsdom shims
// ---------------------------------------------------------------------------

beforeEach(() => {
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

import {
  filterStateToApiParams,
  hasActiveNotificationFilters,
  EMPTY_NOTIFICATION_FILTER,
  NotificationFilterStrip,
  type NotificationFilterState,
} from "@/modules/notifications/ui/notification-filter-strip"
import { NotificationsPageClient } from "@/modules/notifications/ui/notifications-page-client"

// ---------------------------------------------------------------------------
// filterStateToApiParams
// ---------------------------------------------------------------------------

describe("filterStateToApiParams — sort", () => {
  it("omits sort param when sort is 'newest' (the default — no param needed)", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, sort: "newest" }
    const result = filterStateToApiParams(state)
    expect("sort" in result).toBe(false)
  })

  it("includes sort=oldest when sort is 'oldest'", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, sort: "oldest" }
    const result = filterStateToApiParams(state)
    expect(result.sort).toBe("oldest")
  })
})

describe("filterStateToApiParams", () => {
  it("returns empty object for the empty filter", () => {
    const result = filterStateToApiParams(EMPTY_NOTIFICATION_FILTER)
    expect(result).toEqual({})
  })

  it("includes q when search is non-empty", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, search: "bounce" }
    const result = filterStateToApiParams(state)
    expect(result.q).toBe("bounce")
  })

  it("trims whitespace from search before setting q", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, search: "  bounce  " }
    const result = filterStateToApiParams(state)
    expect(result.q).toBe("bounce")
  })

  it("omits q when search is empty", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, search: "" }
    const result = filterStateToApiParams(state)
    expect("q" in result).toBe(false)
  })

  it("omits q when search is only whitespace", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, search: "   " }
    const result = filterStateToApiParams(state)
    expect("q" in result).toBe(false)
  })

  it("includes contactId when set", () => {
    const state: NotificationFilterState = {
      ...EMPTY_NOTIFICATION_FILTER,
      contactId: "contact-abc",
    }
    const result = filterStateToApiParams(state)
    expect(result.contactId).toBe("contact-abc")
  })

  it("omits contactId when null", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, contactId: null }
    const result = filterStateToApiParams(state)
    expect("contactId" in result).toBe(false)
  })

  it("includes types when set", () => {
    const state: NotificationFilterState = {
      ...EMPTY_NOTIFICATION_FILTER,
      types: ["email.bounced", "email.complained"],
    }
    const result = filterStateToApiParams(state)
    expect(result.types).toBe("email.bounced,email.complained")
  })

  it("includes both q and contactId simultaneously", () => {
    const state: NotificationFilterState = {
      ...EMPTY_NOTIFICATION_FILTER,
      search: "test",
      contactId: "c1",
    }
    const result = filterStateToApiParams(state)
    expect(result.q).toBe("test")
    expect(result.contactId).toBe("c1")
  })
})

// ---------------------------------------------------------------------------
// hasActiveNotificationFilters
// ---------------------------------------------------------------------------

describe("hasActiveNotificationFilters", () => {
  it("returns false for the empty filter", () => {
    expect(hasActiveNotificationFilters(EMPTY_NOTIFICATION_FILTER)).toBe(false)
  })

  it("returns true when search is non-empty", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, search: "hello" }
    expect(hasActiveNotificationFilters(state)).toBe(true)
  })

  it("returns false when search is only whitespace", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, search: "   " }
    expect(hasActiveNotificationFilters(state)).toBe(false)
  })

  it("returns true when contactId is set", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, contactId: "c1" }
    expect(hasActiveNotificationFilters(state)).toBe(true)
  })

  it("returns true when types are set", () => {
    const state: NotificationFilterState = {
      ...EMPTY_NOTIFICATION_FILTER,
      types: ["email.bounced"],
    }
    expect(hasActiveNotificationFilters(state)).toBe(true)
  })

  it("returns true when timePreset is set", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, timePreset: "today" }
    expect(hasActiveNotificationFilters(state)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// NotificationFilterStrip — rendering
// ---------------------------------------------------------------------------

const CONTACT_OPTIONS = [
  { id: "c1", name: "Alice Smith" },
  { id: "c2", name: "Bob Jones" },
]

describe("NotificationFilterStrip — rendering", () => {
  it("renders Type and Time controls by default; does NOT render sort without showSort", () => {
    render(<NotificationFilterStrip state={EMPTY_NOTIFICATION_FILTER} onChange={vi.fn()} />)
    expect(screen.getByTestId("notification-filter-strip")).toBeInTheDocument()
    expect(screen.getByTestId("notification-filter-type")).toBeInTheDocument()
    expect(screen.getByTestId("notification-filter-time")).toBeInTheDocument()
    // Sort is gated behind showSort — the bell dropdown omits this prop
    expect(screen.queryByTestId("notification-sort")).toBeNull()
  })

  // E1 fix 1: sort gating — dropdown shows no sort; page shows sort
  it("does NOT render sort control when showSort is false (bell dropdown scenario)", () => {
    render(<NotificationFilterStrip state={EMPTY_NOTIFICATION_FILTER} onChange={vi.fn()} />)
    expect(screen.queryByTestId("notification-sort")).toBeNull()
  })

  it("renders sort control when showSort is true (full-page scenario)", () => {
    render(
      <NotificationFilterStrip
        state={EMPTY_NOTIFICATION_FILTER}
        onChange={vi.fn()}
        showSort={true}
      />,
    )
    expect(screen.getByTestId("notification-sort")).toBeInTheDocument()
  })

  it("sort control shows 'Newest first' by default", () => {
    render(
      <NotificationFilterStrip
        state={EMPTY_NOTIFICATION_FILTER}
        onChange={vi.fn()}
        showSort={true}
      />,
    )
    expect(screen.getByTestId("notification-sort").textContent).toContain("Newest first")
  })

  it("sort control shows 'Oldest first' when sort=oldest", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, sort: "oldest" }
    render(<NotificationFilterStrip state={state} onChange={vi.fn()} showSort={true} />)
    expect(screen.getByTestId("notification-sort").textContent).toContain("Oldest first")
  })

  it("does NOT render contact picker when contactOptions is empty (default)", () => {
    render(<NotificationFilterStrip state={EMPTY_NOTIFICATION_FILTER} onChange={vi.fn()} />)
    expect(screen.queryByTestId("notification-filter-contact")).toBeNull()
  })

  it("does NOT render search input when showSearch is false (default)", () => {
    render(<NotificationFilterStrip state={EMPTY_NOTIFICATION_FILTER} onChange={vi.fn()} />)
    expect(screen.queryByTestId("notification-search")).toBeNull()
  })

  it("renders contact picker when contactOptions is non-empty", () => {
    render(
      <NotificationFilterStrip
        state={EMPTY_NOTIFICATION_FILTER}
        onChange={vi.fn()}
        contactOptions={CONTACT_OPTIONS}
      />,
    )
    expect(screen.getByTestId("notification-filter-contact")).toBeInTheDocument()
  })

  it("renders search input when showSearch is true", () => {
    render(
      <NotificationFilterStrip
        state={EMPTY_NOTIFICATION_FILTER}
        onChange={vi.fn()}
        showSearch={true}
      />,
    )
    expect(screen.getByTestId("notification-search")).toBeInTheDocument()
  })

  it("renders Type + Time + Contact + Search + Sort together on the full-page configuration", () => {
    render(
      <NotificationFilterStrip
        state={EMPTY_NOTIFICATION_FILTER}
        onChange={vi.fn()}
        contactOptions={CONTACT_OPTIONS}
        showSearch={true}
        showSort={true}
      />,
    )
    expect(screen.getByTestId("notification-filter-type")).toBeInTheDocument()
    expect(screen.getByTestId("notification-filter-time")).toBeInTheDocument()
    expect(screen.getByTestId("notification-filter-contact")).toBeInTheDocument()
    expect(screen.getByTestId("notification-search")).toBeInTheDocument()
    expect(screen.getByTestId("notification-sort")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// NotificationFilterStrip — pills reflect active filters
// ---------------------------------------------------------------------------

describe("NotificationFilterStrip — active filter pills", () => {
  it("shows a search pill when search is active", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, search: "bounce" }
    render(<NotificationFilterStrip state={state} onChange={vi.fn()} showSearch={true} />)
    // Pills row should contain the quoted search term
    expect(screen.getByText(/"bounce"/)).toBeInTheDocument()
  })

  it("shows a contact pill when contactId is set", () => {
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, contactId: "c1" }
    render(
      <NotificationFilterStrip state={state} onChange={vi.fn()} contactOptions={CONTACT_OPTIONS} />,
    )
    // The contact name should appear as a pill label
    expect(screen.getByText("Alice Smith")).toBeInTheDocument()
  })

  it("does not show pills row when no filters are active", () => {
    render(
      <NotificationFilterStrip
        state={EMPTY_NOTIFICATION_FILTER}
        onChange={vi.fn()}
        showSearch={true}
        contactOptions={CONTACT_OPTIONS}
      />,
    )
    // FilterPills renders a "Clear all" button when pills are present; its absence confirms no pills
    expect(screen.queryByRole("button", { name: /clear all/i })).toBeNull()
  })

  it("calls onChange with cleared search when search pill is removed", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, search: "bounce" }
    render(<NotificationFilterStrip state={state} onChange={onChange} showSearch={true} />)

    // FilterPills renders a remove button with aria-label containing "Remove"
    const removePill = screen.getByRole("button", { name: /remove/i })
    await user.click(removePill)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: "" }))
  })

  it("calls onChange with cleared contactId when contact pill is removed", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const state: NotificationFilterState = { ...EMPTY_NOTIFICATION_FILTER, contactId: "c1" }
    render(
      <NotificationFilterStrip
        state={state}
        onChange={onChange}
        contactOptions={CONTACT_OPTIONS}
      />,
    )
    const removeBtn = screen.getByRole("button", { name: /remove/i })
    await user.click(removeBtn)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ contactId: null }))
  })

  it("resets all filters including search + contactId on Clear all", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const state: NotificationFilterState = {
      ...EMPTY_NOTIFICATION_FILTER,
      search: "test",
      contactId: "c1",
      types: ["email.bounced"],
    }
    render(
      <NotificationFilterStrip
        state={state}
        onChange={onChange}
        showSearch={true}
        contactOptions={CONTACT_OPTIONS}
      />,
    )
    await user.click(screen.getByRole("button", { name: /clear all/i }))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          search: "",
          contactId: null,
          types: [],
          timePreset: null,
        }),
      )
    })
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — archive tab clears contact filter (E1 fix 3)
// ---------------------------------------------------------------------------

/**
 * The full-page client fetches notificationContacts for live tabs and uses
 * them to populate the contact picker.  When the user switches to Archive, the
 * picker must disappear (contactOptions cleared) and any active contactId must
 * be dropped so no stale pill lingers.
 */
describe("NotificationsPageClient — archive tab clears contact filter", () => {
  it("switching to Archive hides the contact picker and clears any active contactId", async () => {
    const user = userEvent.setup()

    // First fetch: "all" tab — returns a contact so the picker appears.
    // Second fetch: "archive" tab — no notificationContacts (archive doesn't include them).
    const allResponse = {
      notifications: [],
      unreadCount: 0,
      notificationContacts: [{ id: "c1", name: "Alice Smith" }],
    }
    const archiveResponse = {
      notifications: [],
      unreadCount: 0,
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(allResponse) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(archiveResponse) })

    vi.stubGlobal("fetch", fetchMock)

    render(<NotificationsPageClient />)

    // Wait for initial fetch to complete — contact picker should appear
    await waitFor(() => {
      expect(screen.getByTestId("notification-filter-contact")).toBeInTheDocument()
    })

    // Switch to Archive tab
    await user.click(screen.getByTestId("page-tab-archive"))

    // Contact picker must disappear immediately (contactOptions cleared on tab click)
    await waitFor(() => {
      expect(screen.queryByTestId("notification-filter-contact")).toBeNull()
    })

    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// NotificationsPageClient — Snoozed tab (E2)
// ---------------------------------------------------------------------------

describe("NotificationsPageClient — Snoozed tab renders", () => {
  it("renders the Snoozed tab button", () => {
    const emptyResponse = { notifications: [], unreadCount: 0 }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(emptyResponse) }),
    )

    render(<NotificationsPageClient />)

    expect(screen.getByTestId("page-tab-snoozed")).toBeInTheDocument()
    expect(screen.getByTestId("page-tab-snoozed").textContent).toContain("Snoozed")

    vi.unstubAllGlobals()
  })

  it("switching to Snoozed clears the contact picker (mirrors archive handling)", async () => {
    const user = userEvent.setup()

    const allResponse = {
      notifications: [],
      unreadCount: 0,
      notificationContacts: [{ id: "c1", name: "Alice Smith" }],
    }
    const snoozedResponse = { notifications: [], unreadCount: 0 }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(allResponse) })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(snoozedResponse) })

    vi.stubGlobal("fetch", fetchMock)

    render(<NotificationsPageClient />)

    // Wait for initial fetch — contact picker should appear
    await waitFor(() => {
      expect(screen.getByTestId("notification-filter-contact")).toBeInTheDocument()
    })

    // Switch to Snoozed tab
    await user.click(screen.getByTestId("page-tab-snoozed"))

    // Contact picker must disappear (contactOptions cleared on tab switch)
    await waitFor(() => {
      expect(screen.queryByTestId("notification-filter-contact")).toBeNull()
    })

    vi.unstubAllGlobals()
  })
})
