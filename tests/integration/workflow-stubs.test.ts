/**
 * Stub-action surfacing tests. Stripe-blocked / SMS-blocked / IG-
 * blocked / etc. action types ship as runnable code paths that throw
 * an ActionError; the executor records `deferred` status (NOT
 * `failed` and NOT silent success). Partial-progress: a workflow
 * with `[send_email, send_invoice, create_task]` runs the first,
 * defers on the second, and does NOT attempt the third.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { workflows, workflowSteps, workflowExecutions } from "@/modules/workflows/schema"
import { tasks } from "@/modules/tasks/schema"
import { projects } from "@/modules/projects/schema"
import { executeWorkflow } from "@/modules/workflows/executor"

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

import { sendEmail } from "@/lib/email"
const sendEmailMock = sendEmail as unknown as ReturnType<typeof vi.fn>
beforeEach(() => sendEmailMock.mockClear())

async function seedExecution(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  stepConfigs: { actionType: string; actionConfig: Record<string, unknown> | null }[],
) {
  const userId = await createUser(db)
  const orgId = await createOrganization(db, userId)
  await setOrgContext(db, orgId, "owner", userId)
  const workflowId = createId()
  await db.insert(workflows).values({
    id: workflowId,
    organizationId: orgId,
    name: "T",
    triggerType: "opportunity.won",
    enabled: true,
    createdBy: userId,
    updatedBy: userId,
  })
  for (const [idx, step] of stepConfigs.entries()) {
    await db.insert(workflowSteps).values({
      id: createId(),
      organizationId: orgId,
      workflowId,
      sequenceNo: idx,
      actionType: step.actionType,
      actionConfig: step.actionConfig,
      createdBy: userId,
      updatedBy: userId,
    })
  }
  const executionId = createId()
  await db.insert(workflowExecutions).values({
    id: executionId,
    organizationId: orgId,
    workflowId,
    triggerEventType: "opportunity.won",
    triggerEventId: createId(),
    idempotencyKey: createId(),
    status: "pending",
  })
  return { orgId, userId, workflowId, executionId }
}

describe("workflow stubs — Stripe-blocked actions", () => {
  it("send_invoice step → status='deferred', lastError mentions Stripe, audit row written", async () => {
    await withTestDb(async (db) => {
      const env = await seedExecution(db, [
        { actionType: "send_invoice", actionConfig: { invoiceId: "x" } },
      ])
      const result = await executeWorkflow(db, env.executionId)
      expect(result.status).toBe("deferred")
      expect(result.lastError).toMatch(/stripe/i)

      const [exec] = await db
        .select({ status: workflowExecutions.status, lastError: workflowExecutions.lastError })
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, env.executionId))
      expect(exec?.status).toBe("deferred")
      expect(exec?.lastError).toMatch(/stripe/i)
    })
  })

  it("take_payment step → status='deferred'", async () => {
    await withTestDb(async (db) => {
      const env = await seedExecution(db, [{ actionType: "take_payment", actionConfig: null }])
      const result = await executeWorkflow(db, env.executionId)
      expect(result.status).toBe("deferred")
      expect(result.lastError).toMatch(/stripe/i)
    })
  })
})

describe("workflow stubs — other deferred actions", () => {
  it("send_sms step → status='deferred', lastError mentions SMS provider", async () => {
    await withTestDb(async (db) => {
      const env = await seedExecution(db, [{ actionType: "send_sms", actionConfig: null }])
      const r = await executeWorkflow(db, env.executionId)
      expect(r.status).toBe("deferred")
      expect(r.lastError).toMatch(/sms/i)
    })
  })

  it("send_smart_document step → status='deferred', lastError mentions Smart Documents module", async () => {
    await withTestDb(async (db) => {
      const env = await seedExecution(db, [
        { actionType: "send_smart_document", actionConfig: null },
      ])
      const r = await executeWorkflow(db, env.executionId)
      expect(r.status).toBe("deferred")
      expect(r.lastError).toMatch(/smart documents/i)
    })
  })
})

describe("workflow stubs — partial progress is observable", () => {
  it("[send_email, send_invoice, create_task]: first runs, second defers, third NOT attempted", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Need a real project for create_task to point at — but it shouldn't
      // be reached. Still, seed one so the test is deterministic.
      const projectId = createId()
      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: "P",
        createdBy: userId,
        updatedBy: userId,
      })

      const env = await seedExecution(db, [
        {
          actionType: "send_email",
          actionConfig: { to: "x@y.z", subject: "hi", body: "<p>body</p>" },
        },
        { actionType: "send_invoice", actionConfig: null },
        { actionType: "create_task", actionConfig: { title: "T", projectId } },
      ])
      const result = await executeWorkflow(db, env.executionId)

      expect(result.status).toBe("deferred")
      // Email was sent.
      expect(sendEmailMock).toHaveBeenCalledTimes(1)

      // Task was NOT created (third step never attempted).
      const taskRows = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
      expect(taskRows.length).toBe(0)

      // stepResults shows: [succeeded, deferred] — no third entry.
      const [exec] = await db
        .select({ stepResults: workflowExecutions.stepResults })
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, env.executionId))
      const results = exec?.stepResults as { status: string; sequenceNo: number }[] | null
      expect(results?.length).toBe(2)
      expect(results?.[0]?.status).toBe("succeeded")
      expect(results?.[1]?.status).toBe("deferred")
    })
  })
})
