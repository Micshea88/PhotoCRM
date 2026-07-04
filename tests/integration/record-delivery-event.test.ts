/**
 * Integration tests for Task 4 — `recordDeliveryEventInTx` writer.
 *
 * Tests the core writer logic (recordDeliveryEventInTx) via withTestDb so the
 * entire test runs inside a single transaction that auto-rolls-back, preserving
 * test isolation. setOrgContext sets the app.current_org GUC before the writer
 * runs (matching what the public recordDeliveryEvent wrapper does).
 *
 * Covers:
 *   1. bounced event: inserts event row + updates email_log denormalized columns
 *   2. dedup: duplicate providerEventId → only one row, second returns { recorded: false }
 *   3. precedence: delivered after bounced does NOT downgrade delivery_status
 */
import { describe, it, expect } from "vitest"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { emailLog } from "@/modules/email-log/schema"
import { emailDeliveryEvents } from "@/modules/email-delivery/schema"
import { recordDeliveryEventInTx } from "@/modules/email-delivery/ingest"

type Db = Parameters<typeof setOrgContext>[0]

async function seedEmailLog(
  db: Db,
  orgId: string,
  opts: { deliveryStatus?: string } = {},
): Promise<string> {
  const id = createId()
  await db.insert(emailLog).values({
    id,
    organizationId: orgId,
    direction: "outbound",
    sentAt: new Date("2026-07-04T10:00:00Z"),
    source: "resend",
    deliveryStatus: opts.deliveryStatus ?? "sent",
  })
  return id
}

describe("recordDeliveryEventInTx", () => {
  it("bounced event: inserts event row, sets delivery_status, bounced_at, bounce_reason", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const emailLogId = await seedEmailLog(db, orgId)
      const occurredAt = new Date("2026-07-04T11:00:00Z")
      const providerEventId = `svix-${createId()}`

      const result = await recordDeliveryEventInTx(db, {
        organizationId: orgId,
        emailLogId,
        path: "resend",
        type: "bounced",
        bounceClass: "hard",
        detail: { reason: "5.1.1 User unknown" },
        providerEventId,
        occurredAt,
      })

      expect(result).toEqual({ recorded: true })

      // Should have inserted exactly one event row
      const events = await db
        .select()
        .from(emailDeliveryEvents)
        .where(
          and(
            eq(emailDeliveryEvents.emailLogId, emailLogId),
            eq(emailDeliveryEvents.organizationId, orgId),
          ),
        )
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe("bounced")
      expect(events[0]!.providerEventId).toBe(providerEventId)

      // email_log denormalized columns should be updated
      const [log] = await db
        .select({
          deliveryStatus: emailLog.deliveryStatus,
          bouncedAt: emailLog.bouncedAt,
          bounceReason: emailLog.bounceReason,
          failedAt: emailLog.failedAt,
        })
        .from(emailLog)
        .where(eq(emailLog.id, emailLogId))

      expect(log!.deliveryStatus).toBe("bounced")
      expect(log!.bouncedAt).not.toBeNull()
      expect(new Date(log!.bouncedAt!).toISOString()).toBe(occurredAt.toISOString())
      expect(log!.bounceReason).toBe("5.1.1 User unknown")
      expect(log!.failedAt).toBeNull()
    })
  })

  it("dedup: same providerEventId twice → only one event row; second call returns { recorded: false }", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const emailLogId = await seedEmailLog(db, orgId)
      const providerEventId = `svix-${createId()}`
      const occurredAt = new Date("2026-07-04T11:00:00Z")

      const input = {
        organizationId: orgId,
        emailLogId,
        path: "resend" as const,
        type: "delivered" as const,
        providerEventId,
        occurredAt,
      }

      // First call — should insert
      const first = await recordDeliveryEventInTx(db, input)
      expect(first).toEqual({ recorded: true })

      // Second call with same providerEventId — should be deduped
      const second = await recordDeliveryEventInTx(db, input)
      expect(second).toEqual({ recorded: false })

      // Only one row in the events table
      const events = await db
        .select()
        .from(emailDeliveryEvents)
        .where(
          and(
            eq(emailDeliveryEvents.emailLogId, emailLogId),
            eq(emailDeliveryEvents.organizationId, orgId),
          ),
        )
      expect(events).toHaveLength(1)
    })
  })

  it("precedence: delivered event after bounced does NOT downgrade delivery_status", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Start with email_log already at "bounced" status
      const emailLogId = await seedEmailLog(db, orgId, { deliveryStatus: "bounced" })

      // Apply a "delivered" event (lower rank than "bounced")
      const result = await recordDeliveryEventInTx(db, {
        organizationId: orgId,
        emailLogId,
        path: "resend",
        type: "delivered",
        providerEventId: `svix-${createId()}`,
        occurredAt: new Date("2026-07-04T12:00:00Z"),
      })

      expect(result).toEqual({ recorded: true })

      // delivery_status must remain "bounced" — no downgrade
      const [log] = await db
        .select({ deliveryStatus: emailLog.deliveryStatus })
        .from(emailLog)
        .where(eq(emailLog.id, emailLogId))

      expect(log!.deliveryStatus).toBe("bounced")
    })
  })

  it("failed event: sets failed_at and advances delivery_status to failed", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const emailLogId = await seedEmailLog(db, orgId)
      const occurredAt = new Date("2026-07-04T11:30:00Z")

      const result = await recordDeliveryEventInTx(db, {
        organizationId: orgId,
        emailLogId,
        path: "resend",
        type: "failed",
        providerEventId: `svix-${createId()}`,
        occurredAt,
      })

      expect(result).toEqual({ recorded: true })

      const [log] = await db
        .select({
          deliveryStatus: emailLog.deliveryStatus,
          failedAt: emailLog.failedAt,
        })
        .from(emailLog)
        .where(eq(emailLog.id, emailLogId))

      expect(log!.deliveryStatus).toBe("failed")
      expect(log!.failedAt).not.toBeNull()
      expect(new Date(log!.failedAt!).toISOString()).toBe(occurredAt.toISOString())
    })
  })

  it("event without providerEventId can be recorded multiple times (no dedup key)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const emailLogId = await seedEmailLog(db, orgId)

      const input = {
        organizationId: orgId,
        emailLogId,
        path: "nylas" as const,
        type: "delivered" as const,
        // No providerEventId
        occurredAt: new Date("2026-07-04T11:00:00Z"),
      }

      const first = await recordDeliveryEventInTx(db, input)
      expect(first).toEqual({ recorded: true })

      // Without a providerEventId, the partial unique index doesn't apply.
      // Both calls succeed (no dedup).
      const second = await recordDeliveryEventInTx(db, input)
      expect(second).toEqual({ recorded: true })

      const events = await db
        .select()
        .from(emailDeliveryEvents)
        .where(
          and(
            eq(emailDeliveryEvents.emailLogId, emailLogId),
            eq(emailDeliveryEvents.organizationId, orgId),
          ),
        )
      expect(events).toHaveLength(2)
    })
  })
})
