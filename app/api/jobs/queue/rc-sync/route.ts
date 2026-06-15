import { verifyQueueAuth } from "@/modules/jobs/cron-auth"
import { runDueRcSyncJobs } from "@/modules/rc-sync/runner"
import { log } from "@/lib/log"

/**
 * RC-sync job consumer. Kicked by the Layer-2 enqueue action (post-hangup) and
 * — once Build 3 lands — drained by the cron sweep. Auth: x-queue-secret
 * (verifyQueueAuth), same as the example queue route.
 *
 * Drains due jobs (across orgs, system read), reconciling each under its own
 * org-scoped tx. No-op when RC_SYNC_ENABLED is off.
 */
export async function POST(request: Request) {
  if (!verifyQueueAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  try {
    const result = await runDueRcSyncJobs()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
      "[rc-sync] consumer failed",
    )
    return Response.json({ ok: false, error: "rc-sync drain failed" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
