/**
 * Resend webhook → durable queue routing (A3 step 2, Resend).
 *
 * Resend uses the tenant-agnostic "claim-check" inbox: the edge Svix-verifies
 * and enqueues a NULL-ORG `resend_webhook` system job keyed on the svix-id
 * (thin payload — ids only, no message content), and the WORKER resolves the
 * tenant (fetch email + contact-match for inbound; sent-message correlation for
 * delivery). These tests cover the new routing: null-org idempotent enqueue and
 * the handler's delivery-vs-inbound branch. (The processors themselves have
 * their own tests.)
 */
import { describe, it, expect, vi } from "vitest"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { eq, inArray } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"

vi.mock("@/modules/email-delivery/resend-delivery", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ingestResendDeliveryEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/modules/email-log/inbound", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ingestInboundFromEvent: vi.fn().mockResolvedValue(undefined),
}))

import * as schema from "@/db/schema"
import { backgroundJobs } from "@/modules/jobs/queue/schema"
import { enqueueJob } from "@/modules/jobs/queue/queries"
import { processDueJobs } from "@/modules/jobs/queue/runner"
import { jobHandlers } from "@/modules/jobs/queue/handlers"
import { ingestResendDeliveryEvent } from "@/modules/email-delivery/resend-delivery"
import { ingestInboundFromEvent } from "@/modules/email-log/inbound"

const deliveryMock = ingestResendDeliveryEvent as unknown as ReturnType<typeof vi.fn>
const inboundMock = ingestInboundFromEvent as unknown as ReturnType<typeof vi.fn>

function bypassUrl(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required for integration tests")
  const u = new URL(raw)
  u.username = "postgres"
  u.password = "postgres"
  return u.toString()
}

describe("Resend webhook → queue routing", () => {
  it("enqueues a null-org system job keyed on svix-id, idempotent on redelivery", async () => {
    const pool = new Pool({ connectionString: bypassUrl(), max: 3 })
    const db = drizzle(pool, { schema })
    const svixId = `msg_${createId()}`
    const ids: string[] = []
    try {
      const first = await enqueueJob(db, {
        organizationId: null,
        type: "resend_webhook",
        payload: { rawBody: JSON.stringify({ type: "email.delivered" }), svixId },
        idempotencyKey: svixId,
      })
      ids.push(first.id)
      expect(first.enqueued).toBe(true)

      // Svix redelivery of the same message → dedup, no second job.
      const second = await enqueueJob(db, {
        organizationId: null,
        type: "resend_webhook",
        payload: { rawBody: JSON.stringify({ type: "email.delivered" }), svixId },
        idempotencyKey: svixId,
      })
      ids.push(second.id)
      expect(second.enqueued).toBe(false)
      expect(second.id).toBe(first.id)

      const [row] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, first.id))
      expect(row?.organizationId).toBeNull() // tenant-agnostic system-inbox row
      expect(row?.idempotencyKey).toBe(svixId)
    } finally {
      try {
        await db.delete(backgroundJobs).where(inArray(backgroundJobs.id, ids))
      } catch {
        /* best-effort */
      }
      await pool.end()
    }
  })

  it("handler branches: delivery type → delivery processor, else → inbound processor", async () => {
    deliveryMock.mockClear()
    inboundMock.mockClear()
    const pool = new Pool({ connectionString: bypassUrl(), max: 4 })
    const db = drizzle(pool, { schema })
    const ids: string[] = []
    try {
      const delivery = await enqueueJob(db, {
        organizationId: null,
        type: "resend_webhook",
        payload: { rawBody: JSON.stringify({ type: "email.bounced" }), svixId: `d_${createId()}` },
        idempotencyKey: `d_${createId()}`,
      })
      const inbound = await enqueueJob(db, {
        organizationId: null,
        type: "resend_webhook",
        payload: { rawBody: JSON.stringify({ type: "email.received" }), svixId: `i_${createId()}` },
        idempotencyKey: `i_${createId()}`,
      })
      ids.push(delivery.id, inbound.id)

      const result = await processDueJobs(jobHandlers, { db })
      expect(result.done).toBe(2)

      expect(deliveryMock).toHaveBeenCalledTimes(1)
      expect(inboundMock).toHaveBeenCalledTimes(1)
      // The delivery branch forwards the svix id for its own dedup.
      expect(deliveryMock.mock.calls[0]?.[0]).toMatchObject({ type: "email.bounced" })
      expect(inboundMock.mock.calls[0]?.[0]).toMatchObject({ type: "email.received" })
    } finally {
      try {
        await db.delete(backgroundJobs).where(inArray(backgroundJobs.id, ids))
      } catch {
        /* best-effort */
      }
      await pool.end()
    }
  })
})
