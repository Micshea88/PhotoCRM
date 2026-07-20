import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { pruneTerminalJobs } from "@/modules/jobs/queue/queries"
import {
  DONE_RETENTION_DAYS,
  DEAD_RETENTION_DAYS,
  PRUNE_BATCH_LIMIT,
} from "@/modules/jobs/queue/rules"
import { log } from "@/lib/log"

const doneRetentionDays = Number(process.env.QUEUE_DONE_RETENTION_DAYS ?? DONE_RETENTION_DAYS)
const deadRetentionDays = Number(process.env.QUEUE_DEAD_RETENTION_DAYS ?? DEAD_RETENTION_DAYS)
const batchLimit = Number(process.env.QUEUE_PRUNE_BATCH_LIMIT ?? PRUNE_BATCH_LIMIT)
const PRUNE_ENABLED = (process.env.QUEUE_PRUNE_ENABLED ?? "true") !== "false"

/**
 * Retention GC for the durable job queue (`background_jobs`). The queue leaves
 * `done` and `dead` rows in place for observability/reconcile; without this cron
 * they accumulate forever. Runs the base (BYPASSRLS) connection so a single pass
 * sweeps every org plus the null-org system-inbox rows (resend webhooks).
 *
 * NOT audited via `audit()`: this is operational cleanup of an operational table
 * ("Operational, not user data" — schema doc), and `audit_log.organizationId` is
 * NOT NULL so a system-wide/null-org GC can't write a single system audit row —
 * the same reason `purge-deleted` doesn't audit its global `faqEntries` deletes.
 * The structured log line below is the run record.
 *
 * Kill-switch + windows are env-tunable without a deploy (QUEUE_PRUNE_ENABLED,
 * QUEUE_DONE_RETENTION_DAYS, QUEUE_DEAD_RETENTION_DAYS, QUEUE_PRUNE_BATCH_LIMIT).
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  if (!PRUNE_ENABLED) {
    log.warn("[prune-jobs] QUEUE_PRUNE_ENABLED=false — skipping")
    return Response.json({ ok: true, skipped: true, reason: "QUEUE_PRUNE_ENABLED=false" })
  }

  const { doneDeleted, deadDeleted } = await pruneTerminalJobs(db, {
    doneRetentionDays,
    deadRetentionDays,
    batchLimit,
  })

  // A full batch means there was more than one run's worth — the next tick drains
  // the remainder (bounded like purge-deleted).
  const moreToProcess = doneDeleted === batchLimit || deadDeleted === batchLimit

  log.info(
    { feature: "job-queue", doneDeleted, deadDeleted, doneRetentionDays, deadRetentionDays },
    "[prune-jobs] pruned terminal background_jobs",
  )

  return Response.json({
    ok: true,
    pruned: { done: doneDeleted, dead: deadDeleted },
    retentionDays: { done: doneRetentionDays, dead: deadRetentionDays },
    batchLimit,
    moreToProcess,
  })
}
