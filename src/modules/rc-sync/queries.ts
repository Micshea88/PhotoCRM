import "server-only"
import { and, eq, inArray, lte, asc, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import type * as schema from "@/db/schema"
import { rcSyncJobs } from "@/modules/rc-sync/schema"
import { RC_SYNC_BACKOFF_SECONDS, RC_SYNC_MAX_ATTEMPTS } from "@/modules/rc-sync/rules"

type DbHandle = NodePgDatabase<typeof schema>

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000)
}

export interface EnqueueRcSyncArgs {
  organizationId: string
  kind: "call_log" | "transcript" | "ai_notes"
  telephonySessionId?: string | null
  rcCallId?: string | null
}

/** Insert a pending job scheduled for the first attempt (+3s). Runs inside the
 *  caller's tx/org-context. */
export async function enqueueRcSyncJob(tx: DbHandle, args: EnqueueRcSyncArgs): Promise<string> {
  const id = createId()
  await tx.insert(rcSyncJobs).values({
    id,
    organizationId: args.organizationId,
    kind: args.kind,
    telephonySessionId: args.telephonySessionId ?? null,
    rcCallId: args.rcCallId ?? null,
    status: "pending",
    attempts: 0,
    scheduledFor: secondsFromNow(RC_SYNC_BACKOFF_SECONDS[0]),
  })
  return id
}

/**
 * Dedup-aware enqueue: insert a job ONLY if no active (pending|running) job
 * already exists for the same (org, kind, key). The key is the
 * telephony_session_id when present (the Rule-0 reconciliation key), else the
 * rc_call_id. Returns whether a new row was inserted plus the relevant job id.
 *
 * This is the convergence point for the two producers that race on the same
 * call: the dialer's post-hangup enqueue (Layer 2) and the account webhook
 * (Layer 1) both fire for the same telephony session id; whoever lands first
 * creates the job, the other is a no-op. Runs inside the caller's
 * org-context tx (RLS on rc_sync_jobs scopes the existence check to the org).
 */
export async function enqueueIfNoActiveJob(
  tx: DbHandle,
  args: EnqueueRcSyncArgs,
): Promise<{ enqueued: boolean; id: string }> {
  const keyCondition = args.telephonySessionId
    ? eq(rcSyncJobs.telephonySessionId, args.telephonySessionId)
    : args.rcCallId
      ? eq(rcSyncJobs.rcCallId, args.rcCallId)
      : null
  // No usable dedup key → fall back to a plain insert (shouldn't happen for
  // the webhook/dialer paths, which always carry a session id).
  if (!keyCondition) {
    const id = await enqueueRcSyncJob(tx, args)
    return { enqueued: true, id }
  }

  const [existing] = await tx
    .select({ id: rcSyncJobs.id })
    .from(rcSyncJobs)
    .where(
      and(
        eq(rcSyncJobs.organizationId, args.organizationId),
        eq(rcSyncJobs.kind, args.kind),
        keyCondition,
        inArray(rcSyncJobs.status, ["pending", "running"]),
      ),
    )
    .limit(1)
  if (existing) return { enqueued: false, id: existing.id }

  const id = await enqueueRcSyncJob(tx, args)
  return { enqueued: true, id }
}

export interface DueRcSyncJob {
  id: string
  organizationId: string
  kind: string
  telephonySessionId: string | null
  rcCallId: string | null
  attempts: number
}

/**
 * Read pending jobs that are due (or due within a 5s grace, so the immediate
 * post-hangup kick can pick up the +3s attempt-1 and the worker sleeps until
 * due). System read across ALL orgs — runs as the base BYPASSRLS connection
 * (no role downgrade), same pattern as workflow-execute. Not FOR UPDATE; the
 * atomic claim (`claimRcSyncJob`) is the concurrency guard.
 */
export async function selectDueRcSyncJobs(db: DbHandle, limit: number): Promise<DueRcSyncJob[]> {
  return db
    .select({
      id: rcSyncJobs.id,
      organizationId: rcSyncJobs.organizationId,
      kind: rcSyncJobs.kind,
      telephonySessionId: rcSyncJobs.telephonySessionId,
      rcCallId: rcSyncJobs.rcCallId,
      attempts: rcSyncJobs.attempts,
    })
    .from(rcSyncJobs)
    .where(
      and(
        eq(rcSyncJobs.status, "pending"),
        lte(rcSyncJobs.scheduledFor, sql`now() + interval '5 seconds'`),
      ),
    )
    .orderBy(asc(rcSyncJobs.scheduledFor))
    .limit(limit)
}

/** Atomically claim a job: pending → running. Returns true iff this caller won
 *  the claim (another worker may have taken it via the same UPDATE). Runs in
 *  the per-job org-context tx. */
export async function claimRcSyncJob(tx: DbHandle, id: string): Promise<boolean> {
  const claimed = await tx
    .update(rcSyncJobs)
    .set({ status: "running" })
    .where(and(eq(rcSyncJobs.id, id), eq(rcSyncJobs.status, "pending")))
    .returning({ id: rcSyncJobs.id })
  return claimed.length > 0
}

export async function markRcSyncJobDone(tx: DbHandle, id: string): Promise<void> {
  await tx
    .update(rcSyncJobs)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(rcSyncJobs.id, id))
}

/** Apply the backoff schedule: re-schedule pending, or mark dead past the cap. */
export async function markRcSyncJobFailed(
  tx: DbHandle,
  id: string,
  currentAttempts: number,
  error: string,
): Promise<{ dead: boolean }> {
  const nextAttempts = currentAttempts + 1
  if (nextAttempts >= RC_SYNC_MAX_ATTEMPTS) {
    await tx
      .update(rcSyncJobs)
      .set({ status: "dead", attempts: nextAttempts, lastError: error.slice(0, 1000) })
      .where(eq(rcSyncJobs.id, id))
    return { dead: true }
  }
  await tx
    .update(rcSyncJobs)
    .set({
      status: "pending",
      attempts: nextAttempts,
      lastError: error.slice(0, 1000),
      scheduledFor: secondsFromNow(RC_SYNC_BACKOFF_SECONDS[nextAttempts] ?? 900),
    })
    .where(eq(rcSyncJobs.id, id))
  return { dead: false }
}
