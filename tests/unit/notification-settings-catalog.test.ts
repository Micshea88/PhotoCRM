/**
 * Unit tests for the notification settings catalog (Task 15F part 2).
 * Pure — no DB, no server. Tests the NOTIFICATION_SETTINGS_CATALOG structure
 * and the defaultChannelsForRow / rowIsOn helpers.
 */
import { describe, it, expect } from "vitest"
import {
  NOTIFICATION_SETTINGS_CATALOG,
  defaultChannelsForRow,
  rowIsOn,
} from "@/modules/notifications/settings-catalog"
import { NOTIFICATION_TYPES } from "@/modules/notifications/types"
import type { NotificationCategory } from "@/modules/notifications/types"

// ---------------------------------------------------------------------------
// Section structure
// ---------------------------------------------------------------------------

describe("NOTIFICATION_SETTINGS_CATALOG sections", () => {
  it("has exactly 6 sections", () => {
    expect(NOTIFICATION_SETTINGS_CATALOG).toHaveLength(6)
  })

  it("sections are in the required order", () => {
    const keys = NOTIFICATION_SETTINGS_CATALOG.map((s) => s.key)
    expect(keys).toEqual([
      "messages_email",
      "payments",
      "documents",
      "leads",
      "scheduling",
      "system",
    ] satisfies NotificationCategory[])
  })

  it("each section has a non-empty label and at least one row", () => {
    for (const section of NOTIFICATION_SETTINGS_CATALOG) {
      expect(section.label.length).toBeGreaterThan(0)
      expect(section.rows.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Coverage: every registry type appears in exactly one row
// ---------------------------------------------------------------------------

describe("catalog coverage", () => {
  it("every NotificationType appears in exactly one catalog row (no orphans, no dupes)", () => {
    const allTypes = Object.keys(NOTIFICATION_TYPES)
    const typeToRowCount: Record<string, number> = {}

    for (const section of NOTIFICATION_SETTINGS_CATALOG) {
      for (const row of section.rows) {
        for (const type of row.types) {
          typeToRowCount[type] = (typeToRowCount[type] ?? 0) + 1
        }
      }
    }

    // Every registry type must appear
    for (const type of allTypes) {
      expect(typeToRowCount[type], `type ${type} missing from catalog`).toBe(1)
    }

    // No extra types not in the registry
    for (const type of Object.keys(typeToRowCount)) {
      expect(allTypes, `catalog contains unknown type ${type}`).toContain(type)
    }
  })
})

// ---------------------------------------------------------------------------
// Section-specific row checks
// ---------------------------------------------------------------------------

describe("messages_email section rows", () => {
  const section = NOTIFICATION_SETTINGS_CATALOG.find((s) => s.key === "messages_email")!

  it("has a delivery-problems row grouping 3 types", () => {
    const row = section.rows.find((r) => r.label === "Email delivery problems")
    expect(row).toBeDefined()
    expect(row!.types).toEqual(["email.bounced", "email.complained", "email.send_failed"])
  })

  it("has a Client replies row for email.reply_received", () => {
    const row = section.rows.find((r) => r.label === "Client replies")
    expect(row).toBeDefined()
    expect(row!.types).toEqual(["email.reply_received"])
  })

  it("has Link clicked, Email opened, and Text received rows", () => {
    const labels = section.rows.map((r) => r.label)
    expect(labels).toContain("Link clicked")
    expect(labels).toContain("Email opened")
    expect(labels).toContain("Text received")
  })
})

describe("payments section rows", () => {
  const section = NOTIFICATION_SETTINGS_CATALOG.find((s) => s.key === "payments")!

  it("has Payment received and Payment failed rows", () => {
    const labels = section.rows.map((r) => r.label)
    expect(labels).toContain("Payment received")
    expect(labels).toContain("Payment failed")
    expect(section.rows).toHaveLength(2)
  })
})

describe("documents section rows", () => {
  const section = NOTIFICATION_SETTINGS_CATALOG.find((s) => s.key === "documents")!

  it("has 4 rows: proposal, form started, form completed, contract", () => {
    const labels = section.rows.map((r) => r.label)
    expect(labels).toContain("Proposal viewed")
    expect(labels).toContain("Form started")
    expect(labels).toContain("Form completed")
    expect(labels).toContain("Contract signed")
    expect(section.rows).toHaveLength(4)
  })
})

describe("leads section rows", () => {
  const section = NOTIFICATION_SETTINGS_CATALOG.find((s) => s.key === "leads")!

  it("has New inquiry and Untouched-lead reminder rows", () => {
    const labels = section.rows.map((r) => r.label)
    expect(labels).toContain("New inquiry")
    expect(labels).toContain("Untouched-lead reminder (2/5/7 days)")
    expect(section.rows).toHaveLength(2)
  })
})

describe("scheduling section rows", () => {
  const section = NOTIFICATION_SETTINGS_CATALOG.find((s) => s.key === "scheduling")!

  it("has 4 rows: booking made/cancelled, call completed, meeting notes ready", () => {
    const labels = section.rows.map((r) => r.label)
    expect(labels).toContain("Booking made")
    expect(labels).toContain("Booking cancelled")
    expect(labels).toContain("Call completed")
    expect(labels).toContain("Meeting notes ready")
    expect(section.rows).toHaveLength(4)
  })
})

describe("system section rows", () => {
  const section = NOTIFICATION_SETTINGS_CATALOG.find((s) => s.key === "system")!

  it("has Email inbox disconnected and Account & security rows", () => {
    const labels = section.rows.map((r) => r.label)
    expect(labels).toContain("Email inbox disconnected")
    expect(labels).toContain("Account & security")
    expect(section.rows).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// defaultChannelsForRow
// ---------------------------------------------------------------------------

describe("defaultChannelsForRow", () => {
  it("single-type row: returns the type's own defaults", () => {
    const paymentRow = { label: "Payment received", types: ["payment.received"] } as const
    // payment.received: in_app:true, email:true
    expect(defaultChannelsForRow(paymentRow)).toEqual({ in_app: true, email: true })
  })

  it("single-type row for email.opened returns OFF/OFF", () => {
    const openedRow = { label: "Email opened", types: ["email.opened"] } as const
    expect(defaultChannelsForRow(openedRow)).toEqual({ in_app: false, email: false })
  })

  it("delivery-problems row (3 types all ON/ON) merges to ON/ON", () => {
    const deliveryRow = {
      label: "Email delivery problems",
      types: ["email.bounced", "email.complained", "email.send_failed"],
    } as const
    expect(defaultChannelsForRow(deliveryRow)).toEqual({ in_app: true, email: true })
  })

  it("form.started row (bell-only) merges to ON/OFF", () => {
    // form.started: in_app:true, email:false
    const formRow = { label: "Form started", types: ["form.started"] } as const
    expect(defaultChannelsForRow(formRow)).toEqual({ in_app: true, email: false })
  })

  it("mixed row: OR-merge means ON wins over OFF", () => {
    // Hypothetical row mixing email.opened (OFF/OFF) with email.bounced (ON/ON)
    const mixedRow = {
      label: "Mixed",
      types: ["email.opened", "email.bounced"] as const,
    } as Parameters<typeof defaultChannelsForRow>[0]
    expect(defaultChannelsForRow(mixedRow)).toEqual({ in_app: true, email: true })
  })
})

// ---------------------------------------------------------------------------
// rowIsOn
// ---------------------------------------------------------------------------

describe("rowIsOn", () => {
  it("all types ON → row is ON", () => {
    const row = { label: "Delivery", types: ["email.bounced", "email.complained"] } as const
    const prefs = {
      "email.bounced": { in_app: true, email: true },
      "email.complained": { in_app: true, email: true },
    }
    expect(rowIsOn(prefs, row, "in_app")).toBe(true)
    expect(rowIsOn(prefs, row, "email")).toBe(true)
  })

  it("one type OFF → row is OFF", () => {
    const row = { label: "Delivery", types: ["email.bounced", "email.complained"] } as const
    const prefs = {
      "email.bounced": { in_app: true, email: true },
      "email.complained": { in_app: false, email: false }, // one off
    }
    expect(rowIsOn(prefs, row, "in_app")).toBe(false)
    expect(rowIsOn(prefs, row, "email")).toBe(false)
  })

  it("missing pref falls back to registry default", () => {
    // email.opened default is OFF/OFF — no stored pref
    const row = { label: "Email opened", types: ["email.opened"] } as const
    const prefs = {} // no stored prefs
    expect(rowIsOn(prefs, row, "in_app")).toBe(false)
    expect(rowIsOn(prefs, row, "email")).toBe(false)
  })

  it("missing pref for ON-default type returns true", () => {
    // email.bounced default is ON/ON — no stored pref
    const row = { label: "Bounced", types: ["email.bounced"] } as const
    const prefs = {} // no stored prefs
    expect(rowIsOn(prefs, row, "in_app")).toBe(true)
    expect(rowIsOn(prefs, row, "email")).toBe(true)
  })
})
