/**
 * A3 — the documented double-send fix, proven end-to-end: two overlapping cron
 * ticks draining the queue produce EXACTLY ONE client email.
 *
 * Before A3, `executeWorkflow` marked a pending execution running via a
 * non-atomic UPDATE, so two overlapping `workflow-execute` ticks both dispatched
 * the send. Now the trigger-matcher enqueues a `workflow_execution` job and the
 * generic queue's ATOMIC CLAIM is the concurrency guard: two concurrent
 * `processDueJobs` drains race to claim the one job, exactly one wins, and only
 * the winner runs the executor → one send.
 *
 * Real committed data on a superuser pool (mirrors prod's BYPASSRLS base
 * connection that the cross-org poll runs on); sendEmail mocked to count calls.
 */
import { describe, it, expect, vi } from "vitest"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"

// Mock sendEmail at the module boundary so we can count real sends.
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

import { sendEmail } from "@/lib/email"
import * as schema from "@/db/schema"
import { workflows, workflowSteps, workflowExecutions } from "@/modules/workflows/schema"
import { backgroundJobs } from "@/modules/jobs/queue/schema"
import { enqueueJob } from "@/modules/jobs/queue/queries"
import { processDueJobs } from "@/modules/jobs/queue/runner"
import { jobHandlers } from "@/modules/jobs/queue/handlers"

const sendEmailMock = sendEmail as unknown as ReturnType<typeof vi.fn>

function bypassUrl(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required for integration tests")
  const u = new URL(raw)
  u.username = "postgres"
  u.password = "postgres"
  return u.toString()
}

describe("A3 — workflow double-send fix via the queue", () => {
  it("two concurrent queue drains → exactly one send, execution succeeded, job done", async () => {
    sendEmailMock.mockClear()
    const pool = new Pool({ connectionString: bypassUrl(), max: 6 })
    const db = drizzle(pool, { schema })
    const userId = createId()
    const orgId = createId()
    const workflowId = createId()
    const executionId = createId()
    const idempotencyKey = `opportunity.won:${createId()}:${workflowId}`

    try {
      // ── Seed (committed): user, org, workflow + send_email step, a pending
      //    execution, and the queued job that runs it. ──
      await db
        .insert(schema.user)
        .values({
          id: userId,
          name: "T",
          email: `${userId.slice(0, 8)}@ex.com`,
          emailVerified: true,
        })
      await db
        .insert(schema.organization)
        .values({ id: orgId, name: "O", slug: `o-${orgId.slice(0, 8)}`, createdAt: new Date() })
      await db
        .insert(schema.member)
        .values({
          id: createId(),
          organizationId: orgId,
          userId,
          role: "owner",
          createdAt: new Date(),
        })
      await db.insert(workflows).values({
        id: workflowId,
        organizationId: orgId,
        name: "Booked email",
        triggerType: "opportunity.won",
        enabled: true,
        status: "active",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(workflowSteps).values({
        id: createId(),
        organizationId: orgId,
        workflowId,
        sequenceNo: 0,
        actionType: "send_email",
        actionConfig: { to: "client@example.com", subject: "Booked!", body: "<p>Thanks.</p>" },
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(workflowExecutions).values({
        id: executionId,
        organizationId: orgId,
        workflowId,
        triggerEventType: "opportunity.won",
        triggerEventId: createId(),
        idempotencyKey,
        status: "pending",
      })
      await enqueueJob(db, {
        organizationId: orgId,
        type: "workflow_execution",
        payload: { executionId },
        idempotencyKey,
      })

      // ── Two overlapping ticks race to drain the queue. ──
      const [a, b] = await Promise.all([
        processDueJobs(jobHandlers, { db }),
        processDueJobs(jobHandlers, { db }),
      ])

      // Exactly one send — the atomic claim let only one drain run the executor.
      expect(sendEmailMock).toHaveBeenCalledTimes(1)
      // One drain did the job; the other found it already claimed.
      expect(a.done + b.done).toBe(1)

      const [exec] = await db
        .select()
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, executionId))
      expect(exec?.status).toBe("succeeded")

      const [job] = await db
        .select()
        .from(backgroundJobs)
        .where(eq(backgroundJobs.organizationId, orgId))
      expect(job?.status).toBe("done")

      // The send carried the per-step idempotency key (crash-safe resend).
      expect(sendEmailMock.mock.calls[0]?.[0]).toMatchObject({
        idempotencyKey: `wf:${executionId}:0`,
      })
    } finally {
      for (const stmt of [
        () => db.delete(backgroundJobs).where(eq(backgroundJobs.organizationId, orgId)),
        () => db.delete(workflowExecutions).where(eq(workflowExecutions.organizationId, orgId)),
        () => db.delete(workflowSteps).where(eq(workflowSteps.organizationId, orgId)),
        () => db.delete(workflows).where(eq(workflows.organizationId, orgId)),
        () => db.delete(schema.auditLog).where(eq(schema.auditLog.organizationId, orgId)),
        () => db.delete(schema.member).where(eq(schema.member.organizationId, orgId)),
        () => db.delete(schema.organization).where(eq(schema.organization.id, orgId)),
        () => db.delete(schema.user).where(eq(schema.user.id, userId)),
      ]) {
        try {
          await stmt()
        } catch {
          /* best-effort teardown */
        }
      }
      await pool.end()
    }
  })
})
