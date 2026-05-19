import "server-only"
import { eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { tasks, taskDependencies } from "./schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Dependency-flip invariants (KNOWN-DANGEROUS AREA — read this before
 * editing; tests/integration/tasks-dependency-flip.test.ts encodes the
 * full edge-case truth table).
 *
 * Status flips are computed, not user-set. `blocked` is the output of
 * `recomputeTaskStatus`; users never set it directly. Status mutators
 * (markTaskDone, markTaskNotDone, etc.) write the user-facing status
 * AND call `sweepDependentsAfterStatusChange` to propagate to dependents.
 *
 * Rules implemented here:
 *
 *   1. `done` is a final-ish state — once a task is done, recompute is
 *      a no-op. Reopening a blocker does NOT flip a completed dependent
 *      back to blocked. The user can manually un-complete via
 *      markTaskNotDone; that's the only path out of done.
 *
 *   2. If a task has ANY not-done blocker, status is forced to `blocked`.
 *      (Skipped when current status is already `blocked` — avoids an
 *      idempotent UPDATE.)
 *
 *   3. If a task has NO blockers (or all blockers are done) AND current
 *      status is `blocked`, flip to `ready`. Other statuses
 *      (`not_started`, `in_progress`, `ready`) are NOT touched —
 *      removing the last blocker shouldn't move an `in_progress` task
 *      backward to `ready`.
 *
 * Cycle detection (e.g., A → B → A): self-reference is rejected at the
 * input schema (`addTaskDependencyInput` refines taskId !== blockedByTaskId).
 * Deeper cycles are V1-deferred — the UI is expected to prevent them
 * and the recompute helper handles cycles gracefully (it'll loop only
 * once per call site; cycles can't cause infinite recursion because
 * `recomputeTaskStatus` doesn't itself recurse into dependents).
 */

export async function recomputeTaskStatus(db: DbHandle, taskId: string): Promise<void> {
  const [taskRow] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1)
  if (!taskRow) return
  // Rule 1: done is final until manually un-completed.
  if (taskRow.status === "done") return

  // Count not-done blockers in one query. Joining tasks to read each
  // blocker's current status.
  const blockerStatuses = await db
    .select({ blockerStatus: tasks.status })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedByTaskId))
    .where(eq(taskDependencies.taskId, taskId))

  const hasNotDoneBlocker = blockerStatuses.some((b) => b.blockerStatus !== "done")

  if (hasNotDoneBlocker) {
    // Rule 2: any not-done blocker → blocked.
    if (taskRow.status !== "blocked") {
      await db
        .update(tasks)
        .set({ status: "blocked", updatedAt: new Date() })
        .where(eq(tasks.id, taskId))
    }
    return
  }

  // Rule 3: no not-done blockers. If we were blocked, flip to ready;
  // otherwise leave the current status alone (don't drag in_progress
  // backwards).
  if (taskRow.status === "blocked") {
    await db
      .update(tasks)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
  }
}

/**
 * Called by status-mutating actions on a task (markTaskDone, markTaskNotDone)
 * AFTER the task's status has been written. Sweeps every dependent task —
 * i.e., every task that has `blockerTaskId` as one of its blockers — and
 * calls `recomputeTaskStatus` on each. The recompute helper reads the
 * dependent's current status and the blocker's now-current status, so the
 * caller doesn't need to pass the new status.
 */
export async function sweepDependentsAfterStatusChange(
  db: DbHandle,
  blockerTaskId: string,
): Promise<void> {
  const dependents = await db
    .select({ taskId: taskDependencies.taskId })
    .from(taskDependencies)
    .where(eq(taskDependencies.blockedByTaskId, blockerTaskId))
  for (const d of dependents) {
    await recomputeTaskStatus(db, d.taskId)
  }
}
