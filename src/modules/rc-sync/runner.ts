import "server-only"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { log } from "@/lib/log"
import { ringCentralClientWithToken } from "@/lib/ringcentral/client"
import type { RcCallLogRecord } from "@/lib/ringcentral/types"
import { listConnectedProvidersForOrgImpl } from "@/modules/telephony/queries"
import { getValidAccessToken } from "@/modules/telephony/token-refresh"
import { reconcileCallRecord } from "@/modules/rc-sync/reconcile"
import {
  selectDueRcSyncJobs,
  claimRcSyncJob,
  markRcSyncJobDone,
  markRcSyncJobFailed,
  type DueRcSyncJob,
} from "@/modules/rc-sync/queries"

/**
 * RC-sync feature kill-switch. Default OFF — follows the PURGE_ENABLED
 * convention (operational flags read process.env directly). Set
 * RC_SYNC_ENABLED=true to arm Layer 2.
 */
export function isRcSyncEnabled(): boolean {
  return process.env.RC_SYNC_ENABLED === "true"
}

/** Fire-and-forget kick of the consumer route. Best-effort — never throws;
 *  Build 3's cron sweep is the durable backstop. */
export function kickRcSyncConsumer(): void {
  const url = `${env.NEXT_PUBLIC_APP_URL}/api/jobs/queue/rc-sync`
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-queue-secret": env.QUEUE_SECRET },
    body: "{}",
  }).catch(() => undefined)
}

/** Resolve a user in the org with a live RC connection to authenticate as
 *  (account-level call-log is org-wide, so any live connection works). */
async function rcConnectionUserId(
  tx: Parameters<typeof claimRcSyncJob>[0],
): Promise<string | null> {
  const rows = await listConnectedProvidersForOrgImpl(tx)
  return rows.find((r) => r.provider === "ringcentral")?.userId ?? null
}

type JobTx = Parameters<typeof claimRcSyncJob>[0]
type JobOutcome = "done" | "failed" | "dead" | "skipped"

/** Fetch the RC call-log record for a job using a MACHINE-context client built
 *  from a pre-fetched, tx-bound token (no ALS lookup). Default implementation;
 *  injectable in tests so the worker path is exercised without real RC HTTP. */
export type RcRecordFetcher = (
  job: DueRcSyncJob,
  accessToken: string,
) => Promise<RcCallLogRecord | null>

const defaultRecordFetcher: RcRecordFetcher = (job, accessToken) => {
  const client = ringCentralClientWithToken(accessToken, job.organizationId)
  if (job.telephonySessionId) return client.getCallBySessionId(job.telephonySessionId)
  if (job.rcCallId) return client.getCall(job.rcCallId)
  return Promise.resolve(null)
}

/**
 * Process one job inside an already-org-scoped tx. CRITICAL: the token is
 * fetched via `getValidAccessToken(args, tx)` — tx-bound, so it needs NO
 * request ALS context (the bug that bit the first live test was building the
 * client via the request-context `ringCentralClientForUser`, whose token getter
 * called `getValidAccessToken` WITHOUT a tx → `withOrgContext` → "no org context
 * in scope"). Exported + DI on the record fetcher so a no-ALS test can reproduce
 * + guard this exact regression.
 */
export async function runRcSyncJobInTx(
  tx: JobTx,
  job: DueRcSyncJob,
  fetchRecord: RcRecordFetcher = defaultRecordFetcher,
): Promise<JobOutcome> {
  const claimed = await claimRcSyncJob(tx, job.id)
  if (!claimed) return "skipped" // another worker took it

  // Build 2 handles kind="call_log" only; transcript/ai_notes are later builds.
  if (job.kind !== "call_log") {
    await markRcSyncJobFailed(tx, job.id, job.attempts, `unsupported kind "${job.kind}" in Build 2`)
    return "failed"
  }

  try {
    const userId = await rcConnectionUserId(tx)
    if (!userId) {
      const r = await markRcSyncJobFailed(tx, job.id, job.attempts, "no live RC connection for org")
      return r.dead ? "dead" : "failed"
    }
    // Tx-bound token fetch — no ALS context required.
    const { token } = await getValidAccessToken({ organizationId: job.organizationId, userId }, tx)
    const record = await fetchRecord(job, token)
    if (!record) {
      // RC call-log not populated yet — re-defer per backoff.
      const r = await markRcSyncJobFailed(tx, job.id, job.attempts, "RC record not ready")
      return r.dead ? "dead" : "failed"
    }
    await reconcileCallRecord(tx, job.organizationId, record, {
      telephonySessionId: job.telephonySessionId ?? undefined,
    })
    await markRcSyncJobDone(tx, job.id)
    return "done"
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const r = await markRcSyncJobFailed(tx, job.id, job.attempts, msg)
    return r.dead ? "dead" : "failed"
  }
}

async function processJob(job: DueRcSyncJob): Promise<JobOutcome> {
  return db.transaction(async (tx) => {
    // Per-job org context (defense-in-depth: enforce RLS during the write) —
    // matches the workflow-execute machine pattern.
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
    await tx.execute(sql`SELECT set_config('app.current_org', ${job.organizationId}, true)`)
    await tx.execute(sql`SELECT set_config('app.current_role', 'admin', true)`)
    return runRcSyncJobInTx(tx, job)
  })
}

export interface RunResult {
  skipped?: boolean
  processed: number
  done: number
  failed: number
  dead: number
}

/**
 * Drain due rc-sync jobs. Reads across orgs via the base (BYPASSRLS)
 * connection — same machine pattern as workflow-execute — then processes each
 * under its own org-scoped tx.
 */
export async function runDueRcSyncJobs(limit = 20): Promise<RunResult> {
  if (!isRcSyncEnabled()) return { skipped: true, processed: 0, done: 0, failed: 0, dead: 0 }
  const jobs = await selectDueRcSyncJobs(db, limit)
  const res: RunResult = { processed: 0, done: 0, failed: 0, dead: 0 }
  for (const job of jobs) {
    const outcome = await processJob(job)
    if (outcome === "skipped") continue
    res.processed += 1
    if (outcome === "done") res.done += 1
    else if (outcome === "dead") res.dead += 1
    else res.failed += 1
  }
  if (res.processed > 0) {
    log.info({ feature: "rc-sync", ...res }, "rc-sync drain")
  }
  return res
}
