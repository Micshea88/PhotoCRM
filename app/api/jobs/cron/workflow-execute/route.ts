import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { processDueJobs } from "@/modules/jobs/queue/runner"
import { jobHandlers } from "@/modules/jobs/queue/handlers"
import { log } from "@/lib/log"

/**
 * Drains the generic durable job queue: reap expired leases (reclaim crashed /
 * hung jobs), then atomically claim + run due jobs. Today the queue carries
 * `workflow_execution` jobs (enqueued by the trigger-matcher); inbound webhooks
 * and outbound sends route through the same drain as they're migrated.
 *
 * This REPLACES the former direct `SELECT … workflow_executions WHERE
 * status='pending'` sweep, which double-processed on overlapping cron ticks
 * (non-atomic mark-running → duplicate client email). The queue's atomic claim
 * is now the concurrency guard, and the reaper + per-step send idempotency keys
 * give crash-recovery without double-send.
 *
 * Runs on the base connection (BYPASSRLS in prod) so the reap + poll sweep every
 * org; each job is processed under its own app_authenticated, org-scoped tx.
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  try {
    const result = await processDueJobs(jobHandlers, { limit: 100, db })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
      "[workflow-execute] queue drain failed",
    )
    return Response.json({ ok: false, error: "drain failed" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
