import "server-only"
import { sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { db as baseDb } from "@/lib/db"
import { log } from "@/lib/log"
import type * as schema from "@/db/schema"
import {
  reapExpiredLeases,
  selectDueJobs,
  claimJob,
  markJobDone,
  markJobFailed,
  type ClaimableJob,
  type ClaimedJob,
} from "./queries"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * A handler runs the domain work for one claimed job. It executes inside an
 * org-scoped transaction whose CLAIM IS ALREADY COMMITTED (see processJob), so
 * a crash cannot roll the claim back to 'pending' behind a side effect that
 * already happened. Throwing marks the job failed (backoff → DLQ); returning
 * marks it done.
 *
 * Handlers MUST be idempotent: the reaper re-runs a job after a crash, so any
 * external side effect (a client email) has to carry an idempotency key
 * (`job.idempotencyKey`) that the provider dedups on — otherwise a crash
 * between the side effect and markDone yields a double-send.
 */
export type JobHandler = (tx: DbHandle, job: ClaimedJob) => Promise<void>
export type HandlerRegistry = Record<string, JobHandler>

/**
 * Drop a machine-context tx into the NOBYPASSRLS app role + org GUCs — the same
 * pattern as workflow-execute / rc-sync. `view_all='true'` so the RLS overlay
 * (migration 0047) lets system writes touch every event.
 */
async function setMachineContext(tx: DbHandle, organizationId: string): Promise<void> {
  await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
  await tx.execute(sql`SELECT set_config('app.current_org', ${organizationId}, true)`)
  await tx.execute(sql`SELECT set_config('app.current_role', 'admin', true)`)
  await tx.execute(sql`SELECT set_config('app.current_view_all_events', 'true', true)`)
}

export type JobOutcome = "done" | "failed" | "dead" | "skipped" | "no_handler"

export interface DrainResult {
  reaped: { requeued: number; dead: number }
  processed: number
  done: number
  failed: number
  dead: number
  skipped: number
}

/**
 * Process one job with THE COMMIT BOUNDARY that makes external side effects
 * safe:
 *
 *   tx1  claim → COMMIT       (row is durably 'running', lease held)
 *        handler runs         (its own committed tx; the side effect fires here)
 *   tx2  markDone → COMMIT
 *
 * The claim commits BEFORE the handler, so the handler's effect is never
 * trapped inside a transaction that could roll back (rc-sync's single-tx model
 * can't offer this). A crash between tx1 and tx2 leaves the row durably
 * 'running'; the reaper reclaims it and the (idempotent) handler runs again —
 * exactly one effect. markDone/markFailed are fenced by the lease token, so if
 * this worker overran and the reaper already handed the row to another worker,
 * our completion is a no-op.
 */
async function processJob(
  job: ClaimableJob,
  handlers: HandlerRegistry,
  db: DbHandle,
): Promise<JobOutcome> {
  const leaseToken = createId()
  // tx1 — claim + COMMIT.
  const claimed = await db.transaction(async (tx) => {
    await setMachineContext(tx, job.organizationId)
    return claimJob(tx, job.id, leaseToken)
  })
  if (!claimed) return "skipped" // another worker won the claim

  const handler = handlers[job.type]
  if (!handler) {
    await db.transaction(async (tx) => {
      await setMachineContext(tx, job.organizationId)
      await markJobFailed(
        tx,
        job.id,
        leaseToken,
        claimed.attempts,
        claimed.maxAttempts,
        `no handler registered for type "${job.type}"`,
      )
    })
    log.error({ jobId: job.id, type: job.type }, "[job-queue] no handler for type")
    return "no_handler"
  }

  try {
    // handler runs in its own committed tx — the claim is already durable.
    await db.transaction(async (tx) => {
      await setMachineContext(tx, job.organizationId)
      await handler(tx, claimed)
    })
    // tx2 — markDone + COMMIT.
    const done = await db.transaction(async (tx) => {
      await setMachineContext(tx, job.organizationId)
      return markJobDone(tx, job.id, leaseToken)
    })
    // done=false → our lease was reclaimed mid-flight; the reclaimer owns it.
    return done ? "done" : "skipped"
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const res = await db.transaction(async (tx) => {
      await setMachineContext(tx, job.organizationId)
      return markJobFailed(tx, job.id, leaseToken, claimed.attempts, claimed.maxAttempts, msg)
    })
    log.warn({ jobId: job.id, type: job.type, msg }, "[job-queue] job failed")
    return res.dead ? "dead" : "failed"
  }
}

/**
 * One drain pass: reap expired leases (reclaim crashed/hung jobs), then claim +
 * run due jobs. The reap + poll run on the base (BYPASSRLS) connection so they
 * sweep every org in one pass; each job is then processed under its own
 * org-scoped, machine-context transaction. `handlers` and `db` are injectable
 * so tests can drive a real committing pool with a stub handler.
 */
export async function processDueJobs(
  handlers: HandlerRegistry,
  opts: { limit?: number; db?: DbHandle } = {},
): Promise<DrainResult> {
  const db = opts.db ?? baseDb
  const limit = opts.limit ?? 20
  const reaped = await reapExpiredLeases(db)
  const jobs = await selectDueJobs(db, limit)
  const res: DrainResult = { reaped, processed: 0, done: 0, failed: 0, dead: 0, skipped: 0 }
  for (const job of jobs) {
    const outcome = await processJob(job, handlers, db)
    if (outcome === "skipped") {
      res.skipped += 1
      continue
    }
    res.processed += 1
    if (outcome === "done") res.done += 1
    else if (outcome === "dead") res.dead += 1
    else res.failed += 1 // failed + no_handler
  }
  if (res.processed > 0 || reaped.requeued > 0 || reaped.dead > 0) {
    log.info({ feature: "job-queue", ...res }, "[job-queue] drain")
  }
  return res
}
