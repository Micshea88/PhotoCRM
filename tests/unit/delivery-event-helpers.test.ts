/**
 * Unit tests for the pure helper functions in email-delivery/ingest.ts (Task 4).
 * No database — these functions are deterministic and side-effect-free.
 *
 * `@/lib/db` is mocked to prevent the server-env guard from firing in jsdom;
 * the db object itself is never called by the pure helpers.
 */
import { describe, it, expect, vi } from "vitest"

// Must appear before the module-under-test is imported (hoisted by vitest).
vi.mock("@/lib/db", () => ({ db: {} }))

import {
  deliveryStatusRank,
  nextDeliveryStatus,
  classifyBounceClass,
  bounceReasonText,
} from "@/modules/email-delivery/ingest"

describe("deliveryStatusRank", () => {
  it("returns correct rank for each known status", () => {
    expect(deliveryStatusRank("sent")).toBe(0)
    expect(deliveryStatusRank("delivered")).toBe(1)
    expect(deliveryStatusRank("complained")).toBe(2)
    expect(deliveryStatusRank("failed")).toBe(3)
    expect(deliveryStatusRank("bounced")).toBe(4)
  })

  it("returns a value lower than any known status for unknown input", () => {
    expect(deliveryStatusRank("unknown")).toBeLessThan(deliveryStatusRank("sent"))
    expect(deliveryStatusRank("")).toBeLessThan(deliveryStatusRank("sent"))
  })
})

describe("nextDeliveryStatus", () => {
  it("advances from sent to delivered (higher rank)", () => {
    expect(nextDeliveryStatus("sent", "delivered")).toBe("delivered")
  })

  it("does not downgrade from bounced to delivered (lower rank)", () => {
    expect(nextDeliveryStatus("bounced", "delivered")).toBe("bounced")
  })

  it("advances from delivered to bounced (higher rank)", () => {
    expect(nextDeliveryStatus("delivered", "bounced")).toBe("bounced")
  })

  it("does not change status when event is same rank", () => {
    expect(nextDeliveryStatus("sent", "sent")).toBe("sent")
    expect(nextDeliveryStatus("bounced", "bounced")).toBe("bounced")
  })

  it("advances from sent to bounced (skipping intermediate ranks)", () => {
    expect(nextDeliveryStatus("sent", "bounced")).toBe("bounced")
  })

  it("advances from sent to complained", () => {
    expect(nextDeliveryStatus("sent", "complained")).toBe("complained")
  })

  it("does not downgrade from failed to complained (lower rank)", () => {
    expect(nextDeliveryStatus("failed", "complained")).toBe("failed")
  })
})

describe("classifyBounceClass", () => {
  it("classifies a Resend-style hard bounce (bounceType field)", () => {
    expect(classifyBounceClass({ bounceType: "hard" })).toBe("hard")
  })

  it("classifies a Resend-style soft bounce (bounceType field)", () => {
    expect(classifyBounceClass({ bounceType: "soft" })).toBe("soft")
  })

  it("classifies via 'type' field", () => {
    expect(classifyBounceClass({ type: "hard" })).toBe("hard")
    expect(classifyBounceClass({ type: "soft" })).toBe("soft")
  })

  it("classifies permanent as hard, transient as soft", () => {
    expect(classifyBounceClass({ type: "permanent" })).toBe("hard")
    expect(classifyBounceClass({ type: "transient" })).toBe("soft")
  })

  it("returns null for an empty object", () => {
    expect(classifyBounceClass({})).toBeNull()
  })

  it("returns null for null", () => {
    expect(classifyBounceClass(null)).toBeNull()
  })

  it("returns null for a string", () => {
    expect(classifyBounceClass("hard")).toBeNull()
  })

  it("returns null for an array", () => {
    expect(classifyBounceClass([])).toBeNull()
  })

  it("returns null for unrecognized type value", () => {
    expect(classifyBounceClass({ type: "unknown_type" })).toBeNull()
  })
})

describe("bounceReasonText", () => {
  it("extracts from 'reason' field", () => {
    expect(bounceReasonText({ reason: "5.1.1 User unknown" })).toBe("5.1.1 User unknown")
  })

  it("extracts from 'message' field when no reason", () => {
    expect(bounceReasonText({ message: "Mailbox full" })).toBe("Mailbox full")
  })

  it("extracts from 'description' field", () => {
    expect(bounceReasonText({ description: "Bounce: permanent failure" })).toBe(
      "Bounce: permanent failure",
    )
  })

  it("prefers 'reason' over 'message'", () => {
    expect(bounceReasonText({ reason: "Reason wins", message: "Other" })).toBe("Reason wins")
  })

  it("returns null for null", () => {
    expect(bounceReasonText(null)).toBeNull()
  })

  it("returns null for empty object", () => {
    expect(bounceReasonText({})).toBeNull()
  })

  it("returns null for a string input", () => {
    expect(bounceReasonText("5.1.1 User unknown")).toBeNull()
  })

  it("returns null when string fields are empty", () => {
    expect(bounceReasonText({ reason: "" })).toBeNull()
  })
})
