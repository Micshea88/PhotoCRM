/**
 * Workflow idempotency tests — the top danger zone for module 15.
 * A duplicate `send_email` is real-world client-facing harm; these
 * tests pin the two-layer defense:
 *
 *   Layer 1 — execution-level: partial unique index on
 *             (organizationId, workflowId, idempotencyKey) blocks
 *             duplicate executions for the same source event.
 *   Layer 2 — per-step: stepResults[N].status === "succeeded" causes
 *             retry-of-execution to skip already-completed actions.
 *
 * The proof is a sendEmail mock with a call counter: even when the
 * executor is invoked twice for the same execution AND a duplicate
 * trigger fires through the matcher, sendEmail is called EXACTLY ONCE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { workflows, workflowSteps, workflowExecutions } from "@/modules/workflows/schema"
import { auditLog } from "@/modules/audit/schema"
import { executeWorkflow } from "@/modules/workflows/executor"
import {
  matchAuditEventsToWorkflows,
  computeIdempotencyKey,
  computeTimeBasedIdempotencyKey,
} from "@/modules/workflows/trigger-matcher"

// Mock sendEmail at the module boundary so we can count calls.
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

import { sendEmail } from "@/lib/email"

const sendEmailMock = sendEmail as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  sendEmailMock.mockClear()
})

async function seedWorkflowWithSendEmailStep(db: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const userId = await createUser(db)
  const orgId = await createOrganization(db, userId)
  await setOrgContext(db, orgId, "owner", userId)

  const workflowId = createId()
  await db.insert(workflows).values({
    id: workflowId,
    organizationId: orgId,
    name: "Test workflow",
    triggerType: "opportunity.won",
    enabled: true,
    status: "active",
    createdBy: userId,
    updatedBy: userId,
  })
  const stepId = createId()
  await db.insert(workflowSteps).values({
    id: stepId,
    organizationId: orgId,
    workflowId,
    sequenceNo: 0,
    actionType: "send_email",
    actionConfig: {
      to: "client@example.com",
      subject: "Booked!",
      body: "<p>Thanks for booking.</p>",
    },
    createdBy: userId,
    updatedBy: userId,
  })
  return { orgId, userId, workflowId, stepId }
}

describe("workflow idempotency — execution-level (layer 1)", () => {
  it("the partial unique idempotency index blocks duplicate execution rows for the same source event", async () => {
    await withTestDb(async (db) => {
      const env = await seedWorkflowWithSendEmailStep(db)
      const triggerEventId = createId()
      const idempotencyKey = computeIdempotencyKey(
        "opportunity.won",
        triggerEventId,
        env.workflowId,
      )

      // First insert succeeds.
      await db.insert(workflowExecutions).values({
        id: createId(),
        organizationId: env.orgId,
        workflowId: env.workflowId,
        triggerEventType: "opportunity.won",
        triggerEventId,
        idempotencyKey,
        status: "pending",
      })

      // Second insert with the same key should violate the partial unique.
      // Drizzle wraps the pg error; just assert it throws (the next
      // test below proves the ON CONFLICT DO NOTHING path produces the
      // duplicate-skip semantics that production uses).
      await expect(
        db.insert(workflowExecutions).values({
          id: createId(),
          organizationId: env.orgId,
          workflowId: env.workflowId,
          triggerEventType: "opportunity.won",
          triggerEventId,
          idempotencyKey,
          status: "pending",
        }),
      ).rejects.toThrow()
    })
  })

  it("matchAuditEventsToWorkflows: duplicate audit-driven match → second call records duplicate, no new execution", async () => {
    await withTestDb(async (db) => {
      const env = await seedWorkflowWithSendEmailStep(db)

      // Seed an audit-log row that the matcher will pick up.
      await db.insert(auditLog).values({
        id: createId(),
        organizationId: env.orgId,
        action: "opportunities.won",
        actorUserId: env.userId,
        resourceType: "opportunity",
        resourceId: createId(),
        metadata: null,
      })

      const r1 = await matchAuditEventsToWorkflows(db)
      expect(r1.executionsCreated).toBe(1)
      expect(r1.duplicatesSkipped).toBe(0)

      // Re-run the matcher against the same audit rows. The ON CONFLICT
      // DO NOTHING means the second pass produces a duplicate-skip.
      const r2 = await matchAuditEventsToWorkflows(db)
      expect(r2.executionsCreated).toBe(0)
      expect(r2.duplicatesSkipped).toBe(1)

      // Exactly ONE execution exists for this workflow.
      const rows = await db
        .select({ id: workflowExecutions.id })
        .from(workflowExecutions)
        .where(eq(workflowExecutions.workflowId, env.workflowId))
      expect(rows.length).toBe(1)
    })
  })
})

describe("workflow idempotency — per-step (layer 2)", () => {
  it("executor invoked twice for the same execution → sendEmail called EXACTLY ONCE", async () => {
    await withTestDb(async (db) => {
      const env = await seedWorkflowWithSendEmailStep(db)
      const executionId = createId()
      await db.insert(workflowExecutions).values({
        id: executionId,
        organizationId: env.orgId,
        workflowId: env.workflowId,
        triggerEventType: "opportunity.won",
        triggerEventId: createId(),
        idempotencyKey: createId(),
        status: "pending",
      })

      // First execution runs the step.
      const r1 = await executeWorkflow(db, executionId)
      expect(r1.status).toBe("succeeded")
      expect(sendEmailMock).toHaveBeenCalledTimes(1)

      // Second invocation: execution is now `succeeded` — terminal
      // check returns immediately (layer 1).
      const r2 = await executeWorkflow(db, executionId)
      expect(r2.status).toBe("succeeded")
      expect(r2.stepsRun).toBe(0)
      expect(sendEmailMock).toHaveBeenCalledTimes(1)
    })
  })

  it("retry from running status: per-step stepResults skips already-succeeded steps", async () => {
    // Simulate: executor crashed mid-way after sending the email but
    // before persisting status='succeeded'. A retry should see the
    // step succeeded in stepResults and SKIP it.
    await withTestDb(async (db) => {
      const env = await seedWorkflowWithSendEmailStep(db)
      const executionId = createId()
      await db.insert(workflowExecutions).values({
        id: executionId,
        organizationId: env.orgId,
        workflowId: env.workflowId,
        triggerEventType: "opportunity.won",
        triggerEventId: createId(),
        idempotencyKey: createId(),
        status: "pending",
        // Simulate stepResults from a prior partial run.
        stepResults: [
          {
            sequenceNo: 0,
            status: "succeeded",
            completedAt: new Date().toISOString(),
          },
        ],
      })

      const result = await executeWorkflow(db, executionId)
      expect(result.status).toBe("succeeded")
      expect(result.stepsSkipped).toBe(1)
      expect(result.stepsRun).toBe(0)
      // sendEmail was NOT called on this retry — per-step skip works.
      expect(sendEmailMock).toHaveBeenCalledTimes(0)
    })
  })

  it("end-to-end double-fire: matcher runs twice, executor runs twice, sendEmail called ONCE", async () => {
    await withTestDb(async (db) => {
      const env = await seedWorkflowWithSendEmailStep(db)

      // Single audit row.
      const auditEventId = createId()
      await db.insert(auditLog).values({
        id: auditEventId,
        organizationId: env.orgId,
        action: "opportunities.won",
        actorUserId: env.userId,
        resourceType: "opportunity",
        resourceId: createId(),
        metadata: null,
      })

      // First trigger-matcher run creates the execution.
      const m1 = await matchAuditEventsToWorkflows(db)
      expect(m1.executionsCreated).toBe(1)
      const execId = m1.createdExecutionIds[0]!

      // Second matcher run — duplicate; no new execution.
      const m2 = await matchAuditEventsToWorkflows(db)
      expect(m2.duplicatesSkipped).toBe(1)
      expect(m2.executionsCreated).toBe(0)

      // First executor run sends the email.
      await executeWorkflow(db, execId)
      expect(sendEmailMock).toHaveBeenCalledTimes(1)

      // Second executor run — terminal-status no-op.
      await executeWorkflow(db, execId)
      expect(sendEmailMock).toHaveBeenCalledTimes(1)
    })
  })
})

describe("workflow idempotency — keys", () => {
  it("computeIdempotencyKey produces stable output for the same inputs", () => {
    const k1 = computeIdempotencyKey("opportunity.won", "evt_123", "wf_abc")
    const k2 = computeIdempotencyKey("opportunity.won", "evt_123", "wf_abc")
    expect(k1).toBe(k2)
  })

  it("time-based keys include the date — same task fires the same workflow on different days as DISTINCT executions", () => {
    const day1 = computeTimeBasedIdempotencyKey("task.due_soon", "task_abc", "wf_xyz", "2026-09-15")
    const day2 = computeTimeBasedIdempotencyKey("task.due_soon", "task_abc", "wf_xyz", "2026-09-16")
    expect(day1).not.toBe(day2)
  })
})
