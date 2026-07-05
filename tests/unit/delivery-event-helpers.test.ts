/**
 * Unit tests for the pure helper functions in email-delivery/ingest.ts (Task 4).
 * No database — these functions are deterministic and side-effect-free.
 *
 * `@/lib/db` is mocked to prevent the server-env guard from firing in jsdom;
 * the db object itself is never called by the pure helpers.
 *
 * Also covers the public `recordDeliveryEvent` wrapper (Task 4 review finding):
 * proves it opens a transaction, issues the set_config GUC, and delegates to
 * `recordDeliveryEventInTx` — all without touching a real DB.
 */
import { describe, it, expect, vi } from "vitest"

// Must appear before the module-under-test is imported (hoisted by vitest).
vi.mock("@/lib/db", () => ({ db: {} }))

import {
  deliveryStatusRank,
  nextDeliveryStatus,
  classifyBounceClass,
  bounceReasonText,
  recordDeliveryEvent,
} from "@/modules/email-delivery/ingest"
import { db } from "@/lib/db"

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

// ─── Public wrapper: recordDeliveryEvent ──────────────────────────────────────
//
// These tests verify the wrapper's three responsibilities WITHOUT hitting a real
// DB:
//   1. It opens a db.transaction.
//   2. It issues SELECT set_config('app.current_org', <organizationId>, true) as
//      the FIRST statement inside that transaction (before any writes).
//   3. It delegates to recordDeliveryEventInTx (detected via the insert call that
//      the core writer makes) and returns the core writer's result.
//
// Strategy: override (db as any).transaction on the shared vi.mock stub so that
// both the test file and ingest.ts see the same mock object. The mock transaction
// calls the callback with a full set of mocked tx methods and records call order.

describe("recordDeliveryEvent (public wrapper)", () => {
  it("opens a transaction, sets app.current_org GUC first, then delegates to core writer", async () => {
    const orgId = "org_wrapper_test_abc"
    const emailLogId = "log_wrapper_test_xyz"
    const callOrder: string[] = []

    // Capture the SQL argument passed to tx.execute so we can assert on it.
    let capturedSqlArg: unknown = undefined

    // Minimal mock tx that records call ordering and returns just enough for
    // recordDeliveryEventInTx to run without throwing.
    const mockTx = {
      execute: vi.fn((arg: unknown) => {
        capturedSqlArg = arg
        callOrder.push("execute")
        return Promise.resolve()
      }),
      insert: vi.fn(() => {
        callOrder.push("insert")
        return {
          values: vi.fn(() => ({
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ id: "evt_mock_id" }]),
            })),
          })),
        }
      }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ deliveryStatus: "sent" }]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    }

    // Wire the mock transaction onto the shared db stub (same object seen by ingest.ts).
    const mockTransaction = vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx))
    ;(db as unknown as Record<string, unknown>).transaction = mockTransaction

    const result = await recordDeliveryEvent({
      organizationId: orgId,
      emailLogId,
      path: "resend",
      type: "delivered",
      providerEventId: "svix-wrapper-unit-1",
      occurredAt: new Date("2026-07-04T10:00:00Z"),
    })

    // 1. A transaction must have been opened.
    expect(mockTransaction).toHaveBeenCalledOnce()

    // 2. tx.execute must have been called exactly once (the GUC set_config call).
    expect(mockTx.execute).toHaveBeenCalledOnce()

    // 3. The SQL argument must reference set_config and embed the organizationId.
    //    drizzle's sql`` template produces an SQL object whose queryChunks contain
    //    the literal text and the interpolated param. JSON.stringify makes both
    //    accessible for a straightforward assertion.
    const serialized = JSON.stringify(capturedSqlArg)
    expect(serialized).toContain("set_config")
    expect(serialized).toContain(orgId)

    // 4. Delegation: recordDeliveryEventInTx issues an insert — confirm it ran.
    expect(mockTx.insert).toHaveBeenCalled()

    // 5. Ordering: the GUC must be set BEFORE any write (execute before insert).
    expect(callOrder.indexOf("execute")).toBeLessThan(callOrder.indexOf("insert"))

    // 6. The wrapper must return the core writer's result unchanged.
    expect(result).toEqual({ recorded: true })
  })

  it("propagates recorded:false when core writer returns it (duplicate dedup path)", async () => {
    const orgId = "org_dedup_wrapper"
    const emailLogId = "log_dedup_wrapper"

    // Simulate a dedup: insert returns an empty array → core returns { recorded: false }.
    const mockTx = {
      execute: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            // Empty result → duplicate detected by core writer.
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      select: vi.fn(),
      update: vi.fn(),
    }

    ;(db as unknown as Record<string, unknown>).transaction = vi.fn(
      async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    )

    const result = await recordDeliveryEvent({
      organizationId: orgId,
      emailLogId,
      path: "nylas",
      type: "delivered",
      providerEventId: "nylas-dup-1",
      occurredAt: new Date("2026-07-04T10:00:00Z"),
    })

    // GUC was still set even on the dedup path.
    expect(mockTx.execute).toHaveBeenCalledOnce()
    // Core writer returned { recorded: false } and the wrapper passes it through.
    expect(result).toEqual({ recorded: false })
  })
})
