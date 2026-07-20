/**
 * Retention prune for the durable queue (`background_jobs`).
 *
 * The queue never deletes terminal rows on its own, so `done` (completed) and
 * `dead` (DLQ) rows accumulate forever. `pruneTerminalJobs` is the GC:
 *
 *   - `done` rows are operational noise → short retention, keyed on `completedAt`
 *     (the accurate completion time set by markJobDone).
 *   - `dead` rows are forensic evidence of exhausted retries → LONGER retention,
 *     keyed on `updatedAt` (dead rows never set `completedAt`; `updatedAt` is the
 *     time-of-death and nothing touches a dead row after).
 *   - `pending` / `running` rows are live work → NEVER pruned, at any age.
 *
 * These tests assert the OBSERVABLE RESULT (rows actually gone / still present),
 * not that a query ran (LAW 7).
 */
import { describe, it, expect } from "vitest"
import { eq, sql } from "drizzle-orm"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { backgroundJobs } from "@/modules/jobs/queue/schema"
import { enqueueJob, pruneTerminalJobs } from "@/modules/jobs/queue/queries"

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0]

/** Enqueue a job then force it into a terminal state aged `ageDays` in the past.
 *  `done` ages `completedAt`; `dead` ages `updatedAt` (its time-of-death key). */
async function seedTerminalJob(
  db: TestDb,
  orgId: string,
  status: "done" | "dead" | "pending" | "running",
  ageDays: number,
): Promise<string> {
  const { id } = await enqueueJob(db, { organizationId: orgId, type: "test_effect" })
  const aged = sql`now() - make_interval(days => ${ageDays})`
  await db
    .update(backgroundJobs)
    .set({
      status,
      completedAt: status === "done" ? aged : null,
      updatedAt: aged,
    })
    .where(eq(backgroundJobs.id, id))
  return id
}

async function statusOf(db: TestDb, id: string): Promise<string | undefined> {
  const [row] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id))
  return row?.status
}

const RETENTION = { doneRetentionDays: 7, deadRetentionDays: 30, batchLimit: 1000 }

describe("background_jobs — retention prune", () => {
  it("prunes done rows past done-retention, keeps recent ones", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const oldDone = await seedTerminalJob(db, orgId, "done", 10) // > 7 → prune
      const freshDone = await seedTerminalJob(db, orgId, "done", 3) // < 7 → keep

      const res = await pruneTerminalJobs(db, RETENTION)

      expect(res.doneDeleted).toBe(1)
      expect(await statusOf(db, oldDone)).toBeUndefined()
      expect(await statusOf(db, freshDone)).toBe("done")
    })
  })

  it("keeps dead rows LONGER than done rows — dead retention is independent", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Aged 10 days: a done row at this age is pruned (>7), but a dead row at
      // the SAME age is kept (<30) — proving the two retentions are distinct.
      const deadRecent = await seedTerminalJob(db, orgId, "dead", 10) // < 30 → keep
      const deadOld = await seedTerminalJob(db, orgId, "dead", 40) // > 30 → prune

      const res = await pruneTerminalJobs(db, RETENTION)

      expect(res.deadDeleted).toBe(1)
      expect(await statusOf(db, deadRecent)).toBe("dead")
      expect(await statusOf(db, deadOld)).toBeUndefined()
    })
  })

  it("NEVER prunes pending or running rows, however old", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const stalePending = await seedTerminalJob(db, orgId, "pending", 999)
      const staleRunning = await seedTerminalJob(db, orgId, "running", 999)

      const res = await pruneTerminalJobs(db, RETENTION)

      expect(res).toEqual({ doneDeleted: 0, deadDeleted: 0 })
      expect(await statusOf(db, stalePending)).toBe("pending")
      expect(await statusOf(db, staleRunning)).toBe("running")
    })
  })

  it("caps each status at batchLimit so a large backlog drains over runs", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      for (let i = 0; i < 3; i++) await seedTerminalJob(db, orgId, "done", 10)

      const first = await pruneTerminalJobs(db, { ...RETENTION, batchLimit: 2 })
      expect(first.doneDeleted).toBe(2) // capped

      const second = await pruneTerminalJobs(db, { ...RETENTION, batchLimit: 2 })
      expect(second.doneDeleted).toBe(1) // remainder drained next run
    })
  })
})
