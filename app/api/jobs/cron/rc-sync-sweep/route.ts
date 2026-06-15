import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { runDueRcSyncJobs } from "@/modules/rc-sync/runner"
import { log } from "@/lib/log"

/**
 * RC-sync Layer 3 — the durable backoff/self-heal driver.
 *
 * Runs every 5 minutes (vercel.json). Drains due rc_sync_jobs across all orgs,
 * the same body the queue consumer runs. This is what makes the system
 * self-healing: it advances backoff retries for jobs whose RC call-log wasn't
 * ready yet, and re-drives any job the post-hangup kick or a missed webhook
 * left pending. No-op when RC_SYNC_ENABLED is off.
 *
 * Auth: Vercel Cron bearer (verifyCronAuth), same as the other cron routes.
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  try {
    const result = await runDueRcSyncJobs()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    log.error(
      {
        feature: "rc-sync.sweep",
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      },
      "[rc-sync] cron sweep failed",
    )
    return Response.json({ ok: false, error: "rc-sync sweep failed" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
