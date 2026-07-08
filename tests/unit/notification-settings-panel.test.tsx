/**
 * Unit tests for NotificationSettingsPanel (Task 16).
 *
 * Tests:
 * - All 6 sections render in order.
 * - A row with no stored pref shows the registry default.
 * - A row WITH a stored pref overriding the default shows the stored state.
 * - Mobile column is disabled on every row.
 * - Flipping Bell on a grouped row (delivery-problems) invokes the action for
 *   ALL 3 governed types with the expected args.
 * - Email-opened row shows the "timeline only" affordance.
 *
 * Actions and navigation are mocked; no real DB or server calls occur.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ---------------------------------------------------------------------------
// Mocks — defined via vi.hoisted so they are available to vi.mock() factories
// ---------------------------------------------------------------------------

const { updateNotificationPreferenceMock } = vi.hoisted(() => ({
  updateNotificationPreferenceMock: vi.fn((_i: unknown) =>
    Promise.resolve({ data: { type: "email.bounced" } }),
  ),
}))

vi.mock("@/modules/notifications/actions", () => ({
  updateNotificationPreference: updateNotificationPreferenceMock,
}))

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

import { NotificationSettingsPanel } from "@/modules/notifications/ui/notification-settings-panel"
import { NOTIFICATION_SETTINGS_CATALOG } from "@/modules/notifications/settings-catalog"
import type { NotificationPreference } from "@/modules/notifications/schema"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake NotificationPreference row (all required fields). */
function makePref(overrides: {
  type: string
  inApp?: boolean
  email?: boolean
  mobile?: boolean
}): NotificationPreference {
  return {
    id: `pref-${overrides.type}`,
    organizationId: "org1",
    userId: "u1",
    type: overrides.type,
    inApp: overrides.inApp ?? true,
    email: overrides.email ?? true,
    mobile: overrides.mobile ?? false,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationSettingsPanel — section structure", () => {
  beforeEach(() => {
    updateNotificationPreferenceMock.mockClear()
  })

  it("renders all 6 sections in catalog order", () => {
    render(<NotificationSettingsPanel prefs={[]} />)

    const expectedKeys = NOTIFICATION_SETTINGS_CATALOG.map((s) => s.key)
    for (const key of expectedKeys) {
      expect(screen.getByTestId(`section-${key}`)).toBeInTheDocument()
    }
    // Confirm order via DOM position
    const sections = screen.getAllByTestId(/^section-/)
    const renderedKeys = sections.map((el) =>
      el.getAttribute("data-testid")?.replace("section-", ""),
    )
    expect(renderedKeys).toEqual(expectedKeys)
  })

  it("renders at least one row per section", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    for (const section of NOTIFICATION_SETTINGS_CATALOG) {
      for (const row of section.rows) {
        // Row label appears in the DOM
        expect(screen.getByText(row.label)).toBeInTheDocument()
      }
    }
  })
})

describe("NotificationSettingsPanel — registry defaults (no stored pref)", () => {
  it("delivery-problems Bell shows ON (all 3 types default ON/ON)", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    const bell = screen.getByTestId("toggle-bell-email.bounced")
    expect(bell).toHaveAttribute("aria-checked", "true")
  })

  it("delivery-problems Email shows ON (all 3 types default ON/ON)", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    const email = screen.getByTestId("toggle-email-email.bounced")
    expect(email).toHaveAttribute("aria-checked", "true")
  })

  it("email-opened Bell shows OFF (default is OFF/OFF)", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    const bell = screen.getByTestId("toggle-bell-email.opened")
    expect(bell).toHaveAttribute("aria-checked", "false")
  })

  it("email-opened Email shows OFF (default is OFF/OFF)", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    const email = screen.getByTestId("toggle-email-email.opened")
    expect(email).toHaveAttribute("aria-checked", "false")
  })

  it("form.started Bell shows ON (default in_app:true)", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    const bell = screen.getByTestId("toggle-bell-form.started")
    expect(bell).toHaveAttribute("aria-checked", "true")
  })

  it("form.started Email shows OFF (default email:false — bell-only)", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    const email = screen.getByTestId("toggle-email-form.started")
    expect(email).toHaveAttribute("aria-checked", "false")
  })
})

describe("NotificationSettingsPanel — stored pref overrides default", () => {
  it("Link-clicked Email shows OFF when stored pref has email=false", () => {
    const prefs = [makePref({ type: "email.clicked", inApp: true, email: false })]
    render(<NotificationSettingsPanel prefs={prefs} />)
    const email = screen.getByTestId("toggle-email-email.clicked")
    expect(email).toHaveAttribute("aria-checked", "false")
  })

  it("Link-clicked Bell shows ON when stored pref has inApp=true (default ON)", () => {
    const prefs = [makePref({ type: "email.clicked", inApp: true, email: false })]
    render(<NotificationSettingsPanel prefs={prefs} />)
    const bell = screen.getByTestId("toggle-bell-email.clicked")
    expect(bell).toHaveAttribute("aria-checked", "true")
  })

  it("email-opened Bell shows ON when stored pref overrides default OFF to ON", () => {
    const prefs = [makePref({ type: "email.opened", inApp: true, email: false })]
    render(<NotificationSettingsPanel prefs={prefs} />)
    const bell = screen.getByTestId("toggle-bell-email.opened")
    expect(bell).toHaveAttribute("aria-checked", "true")
  })
})

describe("NotificationSettingsPanel — mobile column", () => {
  it("all mobile toggles are disabled", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    const mobileSwitches = screen.getAllByTestId(/^toggle-mobile-/)
    expect(mobileSwitches.length).toBeGreaterThan(0)
    for (const sw of mobileSwitches) {
      expect(sw).toBeDisabled()
    }
  })

  it("total mobile toggle count matches total row count", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    const totalRows = NOTIFICATION_SETTINGS_CATALOG.reduce((sum, s) => sum + s.rows.length, 0)
    const mobileSwitches = screen.getAllByTestId(/^toggle-mobile-/)
    expect(mobileSwitches).toHaveLength(totalRows)
  })
})

describe("NotificationSettingsPanel — grouped row toggle", () => {
  beforeEach(() => {
    updateNotificationPreferenceMock.mockClear()
    updateNotificationPreferenceMock.mockResolvedValue({ data: { type: "ok" } })
  })

  it("flipping Bell on delivery-problems (OFF→ no stored pref means ON) calls action 3 times", async () => {
    const user = userEvent.setup()
    // No stored prefs → delivery-problems defaults to Bell ON.
    // Clicking it should flip to OFF, calling updateNotificationPreference for all 3 types.
    render(<NotificationSettingsPanel prefs={[]} />)

    const bell = screen.getByTestId("toggle-bell-email.bounced")
    expect(bell).toHaveAttribute("aria-checked", "true")

    await user.click(bell)

    await waitFor(() => {
      expect(updateNotificationPreferenceMock).toHaveBeenCalledTimes(3)
    })

    const calls = updateNotificationPreferenceMock.mock.calls as [
      { type: string; inApp: boolean; email: boolean; mobile: boolean },
    ][]
    const types = calls.map(([arg]) => arg.type).sort()
    expect(types).toEqual(["email.bounced", "email.complained", "email.send_failed"].sort())

    // All should set inApp=false (toggled OFF), email unchanged (still true from default)
    for (const [arg] of calls) {
      expect(arg.inApp).toBe(false)
      expect(arg.email).toBe(true) // email channel unchanged
      expect(arg.mobile).toBe(false)
    }
  })

  it("flipping Email on delivery-problems calls action 3 times with email=false", async () => {
    const user = userEvent.setup()
    render(<NotificationSettingsPanel prefs={[]} />)

    const emailToggle = screen.getByTestId("toggle-email-email.bounced")
    await user.click(emailToggle)

    await waitFor(() => {
      expect(updateNotificationPreferenceMock).toHaveBeenCalledTimes(3)
    })

    const calls = updateNotificationPreferenceMock.mock.calls as [
      { type: string; inApp: boolean; email: boolean; mobile: boolean },
    ][]
    for (const [arg] of calls) {
      expect(arg.email).toBe(false)
      expect(arg.inApp).toBe(true) // bell unchanged
    }
  })
})

describe("NotificationSettingsPanel — email-opened affordance", () => {
  it("shows the timeline-only note for the email-opened row", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    const note = screen.getByTestId("email-opened-timeline-note")
    expect(note).toBeInTheDocument()
    expect(note.textContent).toContain("timeline")
  })

  it("does NOT show the timeline-only note on other rows", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    // Only exactly one element with this testid
    const notes = screen.getAllByTestId("email-opened-timeline-note")
    expect(notes).toHaveLength(1)
  })
})

describe("NotificationSettingsPanel — sms.received hint", () => {
  it("shows SMS setup hint on the Text received row", () => {
    render(<NotificationSettingsPanel prefs={[]} />)
    expect(screen.getByText(/starts when sms is set up/i)).toBeInTheDocument()
  })
})
