/**
 * A3 follow-up — transient step-failure retry, proven end-to-end through the
 * real queue on a committing pool.
 *
 * The headline safety property: a workflow whose `send_email` step fails
 * transiently is RETRIED, and because the executor throws (rolling the whole
 * attempt back) rather than half-committing, a `create_task` step BEFORE the
 * send is NOT duplicated across the retry — exactly ONE task exists after the
 * run succeeds, and the send carries a stable idempotency key so the provider
 * dedups the re-send. This is the guarantee that makes retry safe: DB effects
 * roll back with the failed attempt; the only external effect (email) is
 * idempotency-keyed.
 *
 * Also proven: a PERMANENT (ActionError) failure is terminal on the first
 * attempt with no retry, and a transient failure that exhausts the queue's
 * attempts finalizes the execution `failed` rather than stranding it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { eq, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))

import { sendEmail } from "@/lib/email"
import { isTransientWorkflowError } from "@/modules/workflows/executor"
import { ActionError } from "@/lib/safe-action"
import * as schema from "@/db/schema"
import { workflows, workflowSteps, workflowExecutions } from "@/modules/workflows/schema"
import { projects } from "@/modules/projects/schema"
import { tasks } from "@/modules/tasks/schema"
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

type Db = ReturnType<typeof drizzle<typeof schema>>

interface StepSpec {
  actionType: string
  actionConfig: Record<string, unknown>
}

/** Seed org + project + a workflow with the given steps + a pending execution +
 *  its queued job. Returns ids and a teardown that removes everything. */
async function seed(db: Db, steps: StepSpec[], maxAttempts: number) {
  const userId = createId()
  const orgId = createId()
  const projectId = createId()
  const workflowId = createId()
  const executionId = createId()
  const idempotencyKey = `test:${createId()}`

  await db
    .insert(schema.user)
    .values({ id: userId, name: "T", email: `${userId.slice(0, 8)}@ex.com`, emailVerified: true })
  await db
    .insert(schema.organization)
    .values({ id: orgId, name: "O", slug: `o-${orgId.slice(0, 8)}`, createdAt: new Date() })
  await db
    .insert(schema.member)
    .values({ id: createId(), organizationId: orgId, userId, role: "owner", createdAt: new Date() })
  await db.insert(projects).values({ id: projectId, organizationId: orgId, name: "P" })
  await db.insert(workflows).values({
    id: workflowId,
    organizationId: orgId,
    name: "wf",
    triggerType: "opportunity.won",
    enabled: true,
    status: "active",
    createdBy: userId,
    updatedBy: userId,
  })
  await db.insert(workflowSteps).values(
    steps.map((s, i) => ({
      id: createId(),
      organizationId: orgId,
      workflowId,
      sequenceNo: i,
      actionType: s.actionType,
      actionConfig: s.actionConfig,
      createdBy: userId,
      updatedBy: userId,
    })),
  )
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
    maxAttempts,
  })

  async function teardown() {
    for (const stmt of [
      () => db.delete(backgroundJobs).where(eq(backgroundJobs.organizationId, orgId)),
      () => db.delete(workflowExecutions).where(eq(workflowExecutions.organizationId, orgId)),
      () => db.delete(workflowSteps).where(eq(workflowSteps.organizationId, orgId)),
      () => db.delete(workflows).where(eq(workflows.organizationId, orgId)),
      () => db.delete(tasks).where(eq(tasks.organizationId, orgId)),
      () => db.delete(projects).where(eq(projects.organizationId, orgId)),
      () => db.delete(schema.auditLog).where(eq(schema.auditLog.organizationId, orgId)),
      () => db.delete(schema.member).where(eq(schema.member.organizationId, orgId)),
      () => db.delete(schema.organization).where(eq(schema.organization.id, orgId)),
      () => db.delete(schema.user).where(eq(schema.user.id, userId)),
    ]) {
      try {
        await stmt()
      } catch {
        /* best-effort */
      }
    }
  }

  return { userId, orgId, projectId, workflowId, executionId, teardown }
}

const execStatus = (db: Db, id: string) =>
  db
    .select({ s: workflowExecutions.status })
    .from(workflowExecutions)
    .where(eq(workflowExecutions.id, id))
    .then((r) => r[0]?.s)

const jobStatus = (db: Db, orgId: string) =>
  db
    .select({ s: backgroundJobs.status })
    .from(backgroundJobs)
    .where(eq(backgroundJobs.organizationId, orgId))
    .then((r) => r[0]?.s)

const taskCount = (db: Db, orgId: string) =>
  db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.organizationId, orgId))
    .then((r) => r[0]?.n ?? 0)

/** Clear the queue backoff so the next drain re-claims the job immediately. */
const forceJobDue = (db: Db, orgId: string) =>
  db
    .update(backgroundJobs)
    .set({ scheduledFor: sql`now()` })
    .where(eq(backgroundJobs.organizationId, orgId))

describe("isTransientWorkflowError — retry classifier", () => {
  it("treats every ActionError code as PERMANENT (not transient)", () => {
    for (const code of [
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NO_ACTIVE_ORG",
      "NOT_FOUND",
      "VALIDATION",
      "CONFLICT",
    ] as const) {
      expect(isTransientWorkflowError(new ActionError(code, "x"))).toBe(false)
    }
  })

  it("treats a plain provider/network Error, and non-Error throwables, as TRANSIENT", () => {
    expect(isTransientWorkflowError(new Error("Email send failed: 429"))).toBe(true)
    expect(isTransientWorkflowError("boom")).toBe(true)
    expect(isTransientWorkflowError(undefined)).toBe(true)
  })
})

describe("workflow transient-failure retry", () => {
  beforeEach(() => sendEmailMock.mockReset())

  it("transient send failure retries and does NOT duplicate a prior create_task step", async () => {
    const pool = new Pool({ connectionString: bypassUrl(), max: 6 })
    const db = drizzle(pool, { schema })
    // First send throws (transient), the retry succeeds.
    sendEmailMock
      .mockRejectedValueOnce(new Error("Email send failed: 429 Too Many Requests"))
      .mockResolvedValue(undefined)

    const s = await seed(
      db,
      [
        { actionType: "create_task", actionConfig: { title: "Follow up" } },
        {
          actionType: "send_email",
          actionConfig: { to: "c@ex.com", subject: "Hi", body: "<p>hi</p>" },
        },
      ],
      3,
    )
    // create_task reads projectId from the trigger payload; set it on the row.
    await db
      .update(workflowExecutions)
      .set({ triggerPayload: { projectId: s.projectId } })
      .where(eq(workflowExecutions.id, s.executionId))

    try {
      // Attempt 1 — the send throws → the whole attempt rolls back.
      await processDueJobs(jobHandlers, { db })
      expect(await execStatus(db, s.executionId)).toBe("pending") // mark-running rolled back
      expect(await jobStatus(db, s.orgId)).toBe("pending") // requeued with backoff
      expect(await taskCount(db, s.orgId)).toBe(0) // create_task rolled back — no orphan
      expect(sendEmailMock).toHaveBeenCalledTimes(1)

      // Attempt 2 — send succeeds → execution completes.
      await forceJobDue(db, s.orgId)
      await processDueJobs(jobHandlers, { db })

      expect(await execStatus(db, s.executionId)).toBe("succeeded")
      expect(await jobStatus(db, s.orgId)).toBe("done")
      expect(await taskCount(db, s.orgId)).toBe(1) // EXACTLY ONE task, not duplicated
      // Every send used the same stable per-step key → provider dedups the re-send.
      for (const call of sendEmailMock.mock.calls) {
        expect(call[0]).toMatchObject({ idempotencyKey: `wf:${s.executionId}:1` })
      }
    } finally {
      await s.teardown()
      await pool.end()
    }
  })

  it("permanent (ActionError) failure is terminal on the first attempt — no retry", async () => {
    const pool = new Pool({ connectionString: bypassUrl(), max: 6 })
    const db = drizzle(pool, { schema })
    const s = await seed(
      db,
      // create_task with no projectId (and none on the payload) → ActionError VALIDATION.
      [{ actionType: "create_task", actionConfig: { title: "x" } }],
      3,
    )
    try {
      await processDueJobs(jobHandlers, { db })
      expect(await execStatus(db, s.executionId)).toBe("failed")
      expect(await jobStatus(db, s.orgId)).toBe("done") // marked done, NOT requeued
      expect(await taskCount(db, s.orgId)).toBe(0)
    } finally {
      await s.teardown()
      await pool.end()
    }
  })

  it("transient failure that exhausts attempts finalizes the execution failed", async () => {
    const pool = new Pool({ connectionString: bypassUrl(), max: 6 })
    const db = drizzle(pool, { schema })
    sendEmailMock
      .mockRejectedValueOnce(new Error("Email send failed: 503"))
      .mockRejectedValueOnce(new Error("Email send failed: 503"))
    const s = await seed(
      db,
      [{ actionType: "send_email", actionConfig: { to: "c@ex.com", subject: "s", body: "b" } }],
      2, // two attempts total
    )
    try {
      await processDueJobs(jobHandlers, { db }) // attempt 1 → transient throw → requeue
      expect(await execStatus(db, s.executionId)).toBe("pending")
      expect(await jobStatus(db, s.orgId)).toBe("pending")

      await forceJobDue(db, s.orgId)
      await processDueJobs(jobHandlers, { db }) // attempt 2 = final → finalize failed

      expect(await execStatus(db, s.executionId)).toBe("failed")
      expect(await jobStatus(db, s.orgId)).toBe("done")
      expect(sendEmailMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    } finally {
      await s.teardown()
      await pool.end()
    }
  })
})
