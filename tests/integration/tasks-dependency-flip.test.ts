import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext, type TestDb } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { projects } from "@/modules/projects/schema"
import { tasks, taskDependencies } from "@/modules/tasks/schema"
import {
  recomputeTaskStatus,
  sweepDependentsAfterStatusChange,
} from "@/modules/tasks/dependency-flip"

/**
 * DANGEROUS-AREA EDGE-CASE TESTS (written before the helper implementation
 * per the user's explicit instruction). These exercise the
 * recomputeTaskStatus + sweepDependentsAfterStatusChange invariants:
 *
 *   - blocked → ready ONLY when every blocker is done
 *   - done tasks STAY done even when blockers reopen
 *   - re-adding a not-done blocker to a ready task → blocked
 *   - removing the last not-done blocker → ready
 *   - direct self-block rejected (enforced in the input schema, but
 *     the helper should be defensive)
 *   - adding a dep where the blocker is already done → no transition
 *     (task status unchanged)
 *
 * The helper is a pure function on a tx handle. It does not touch
 * dependency rows itself — callers (the actions) add/remove deps and
 * then call the helper. The helper reads the live blocker rows and
 * updates `status` accordingly.
 *
 * Invariants encoded as assertions:
 *   1. recomputeTaskStatus(tx, taskId):
 *      - If task.status='done', no-op.
 *      - Else if task has at least one not-done blocker, set status='blocked'.
 *      - Else if task.status='blocked', flip to 'ready'.
 *      - Else (no blockers, status in {not_started, ready, in_progress}),
 *        no change.
 *   2. sweepDependentsAfterStatusChange(tx, blockerTaskId):
 *      - For each task that has blockerTaskId as a blocker, call
 *        recomputeTaskStatus.
 *
 * Calling these from actions:
 *   - markTaskDone(t): UPDATE status='done', completedAt=now;
 *                     then sweepDependentsAfterStatusChange(t).
 *   - markTaskNotDone(t): UPDATE status='not_started' (or as input);
 *                     then sweepDependentsAfterStatusChange(t) — dependents
 *                     that were ready flip to blocked.
 *   - addTaskDependency(taskId, blockerId): INSERT row; then
 *                     recomputeTaskStatus(taskId).
 *   - removeTaskDependency(depId): DELETE row; then
 *                     recomputeTaskStatus(its taskId).
 */

async function seedScaffold(db: TestDb) {
  const userId = await createUser(db)
  const orgId = await createOrganization(db, userId)
  await setOrgContext(db, orgId)
  const projectId = createId()
  await db.insert(projects).values({
    id: projectId,
    organizationId: orgId,
    name: "P",
    createdBy: userId,
    updatedBy: userId,
  })
  return { userId, orgId, projectId }
}

async function makeTask(
  db: TestDb,
  scaffold: { userId: string; orgId: string; projectId: string },
  overrides: { status?: string; title?: string } = {},
) {
  const id = createId()
  await db.insert(tasks).values({
    id,
    organizationId: scaffold.orgId,
    projectId: scaffold.projectId,
    title: overrides.title ?? `Task ${id.slice(0, 6)}`,
    status: overrides.status ?? "not_started",
    createdBy: scaffold.userId,
    updatedBy: scaffold.userId,
  })
  return id
}

async function addDep(
  db: TestDb,
  scaffold: { orgId: string; userId: string },
  taskId: string,
  blockerId: string,
) {
  await db.insert(taskDependencies).values({
    id: createId(),
    organizationId: scaffold.orgId,
    taskId,
    blockedByTaskId: blockerId,
    createdBy: scaffold.userId,
  })
}

async function readStatus(db: TestDb, id: string) {
  const [row] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, id))
  return row?.status ?? null
}

describe("recomputeTaskStatus — edge cases", () => {
  it("A blocked by B + C; B done, C not done → A stays blocked", async () => {
    await withTestDb(async (db) => {
      const s = await seedScaffold(db)
      const A = await makeTask(db, s)
      const B = await makeTask(db, s, { status: "done" })
      const C = await makeTask(db, s, { status: "not_started" })
      await addDep(db, s, A, B)
      await addDep(db, s, A, C)
      await recomputeTaskStatus(db, A)
      expect(await readStatus(db, A)).toBe("blocked")
    })
  })

  it("A blocked by B + C; both done → A flips to ready", async () => {
    await withTestDb(async (db) => {
      const s = await seedScaffold(db)
      const A = await makeTask(db, s, { status: "blocked" })
      const B = await makeTask(db, s, { status: "done" })
      const C = await makeTask(db, s, { status: "done" })
      await addDep(db, s, A, B)
      await addDep(db, s, A, C)
      await recomputeTaskStatus(db, A)
      expect(await readStatus(db, A)).toBe("ready")
    })
  })

  it("A has no blockers → status untouched", async () => {
    await withTestDb(async (db) => {
      const s = await seedScaffold(db)
      const A = await makeTask(db, s, { status: "in_progress" })
      await recomputeTaskStatus(db, A)
      expect(await readStatus(db, A)).toBe("in_progress")
    })
  })

  it("A is done; reopen blocker B → A stays done (final-state rule)", async () => {
    await withTestDb(async (db) => {
      const s = await seedScaffold(db)
      const A = await makeTask(db, s, { status: "done" })
      const B = await makeTask(db, s, { status: "done" })
      await addDep(db, s, A, B)
      // Reopen the blocker.
      await db.update(tasks).set({ status: "not_started" }).where(eq(tasks.id, B))
      await sweepDependentsAfterStatusChange(db, B)
      expect(await readStatus(db, A)).toBe("done")
    })
  })

  it("Sweep after blocker B becomes done: A flips from blocked → ready", async () => {
    await withTestDb(async (db) => {
      const s = await seedScaffold(db)
      const A = await makeTask(db, s, { status: "blocked" })
      const B = await makeTask(db, s, { status: "not_started" })
      await addDep(db, s, A, B)
      // Simulate markTaskDone(B):
      await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, B))
      await sweepDependentsAfterStatusChange(db, B)
      expect(await readStatus(db, A)).toBe("ready")
    })
  })

  it("addTaskDependency when blocker is ALREADY done → no transition", async () => {
    await withTestDb(async (db) => {
      const s = await seedScaffold(db)
      // A is ready (no dependencies yet).
      const A = await makeTask(db, s, { status: "ready" })
      const B = await makeTask(db, s, { status: "done" })
      await addDep(db, s, A, B)
      await recomputeTaskStatus(db, A)
      // Stays ready — the new blocker is already done.
      expect(await readStatus(db, A)).toBe("ready")
    })
  })

  it("A is ready; add new blocker C (not done) → A flips to blocked", async () => {
    await withTestDb(async (db) => {
      const s = await seedScaffold(db)
      const A = await makeTask(db, s, { status: "ready" })
      const C = await makeTask(db, s, { status: "not_started" })
      await addDep(db, s, A, C)
      await recomputeTaskStatus(db, A)
      expect(await readStatus(db, A)).toBe("blocked")
    })
  })

  it("Remove the last not-done blocker → A flips to ready", async () => {
    await withTestDb(async (db) => {
      const s = await seedScaffold(db)
      const A = await makeTask(db, s, { status: "blocked" })
      const B = await makeTask(db, s, { status: "not_started" })
      await addDep(db, s, A, B)
      // Verify A starts blocked.
      await recomputeTaskStatus(db, A)
      expect(await readStatus(db, A)).toBe("blocked")
      // Remove the dependency, then recompute.
      await db.delete(taskDependencies).where(eq(taskDependencies.taskId, A))
      await recomputeTaskStatus(db, A)
      expect(await readStatus(db, A)).toBe("ready")
    })
  })
})
