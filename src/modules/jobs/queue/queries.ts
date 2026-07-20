import "server-only"
import { and, asc, eq, lte, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import type * as schema from "@/db/schema"
import { backgroundJobs } from "./schema"
import { DEFAULT_MAX_ATTEMPTS, LEASE_DURATION_SECONDS, backoffSecondsForAttempt } from "./rules"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * A timestamp `seconds` in the future, evaluated on the DATABASE clock — never
 * the Node clock. All due/lease comparisons (`selectDueJobs`, `claimJob`, the
 * reaper) run against Postgres `now()`, so scheduling must too; mixing the two
 * lets host↔DB clock skew (e.g. a Docker VM lagging the host) make a "now" job
 * look like the future and never get claimed.
 */
function dbSecondsFromNow(seconds: number) {
  return sql`now() + make_interval(secs => ${seconds})`
}

// ─── Producer ──────────────────────────────────────────────────────────────

export interface EnqueueJobArgs {
  organizationId: string
  type: string
  payload?: Record<string, unknown>
  /** Exactly-once key. When set, a redelivery of the same (org, type, key) is a
   *  no-op (partial unique index). Null → no dedup (every call inserts). */
  idempotencyKey?: string | null
  maxAttempts?: number
  /** Delay before the job is first eligible to run (seconds). Default 0 = now. */
  delaySeconds?: number
}

/**
 * Insert a pending job. Idempotent when `idempotencyKey` is set:
 * `onConflictDoNothing` catches the partial unique index, so a webhook
 * redelivery for the same event id is a no-op. Returns `{ id, enqueued }` —
 * `enqueued=false` means a job for that key already existed (and `id` is the
 * existing row's id). Runs inside the caller's org-context tx.
 */
export async function enqueueJob(
  tx: DbHandle,
  args: EnqueueJobArgs,
): Promise<{ id: string; enqueued: boolean }> {
  const id = createId()
  const inserted = await tx
    .insert(backgroundJobs)
    .values({
      id,
      organizationId: args.organizationId,
      type: args.type,
      payload: args.payload ?? {},
      idempotencyKey: args.idempotencyKey ?? null,
      maxAttempts: args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      status: "pending",
      attempts: 0,
      scheduledFor: dbSecondsFromNow(args.delaySeconds ?? 0),
    })
    .onConflictDoNothing()
    .returning({ id: backgroundJobs.id })

  if (inserted.length > 0) return { id, enqueued: true }

  // Conflict on the idempotency key — the job already exists. Return its id.
  const [existing] = await tx
    .select({ id: backgroundJobs.id })
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.organizationId, args.organizationId),
        eq(backgroundJobs.type, args.type),
        eq(backgroundJobs.idempotencyKey, args.idempotencyKey ?? ""),
      ),
    )
    .limit(1)
  return { id: existing?.id ?? id, enqueued: false }
}

// ─── Consumer ──────────────────────────────────────────────────────────────

export interface ClaimableJob {
  id: string
  organizationId: string
  type: string
  payload: unknown
  attempts: number
  maxAttempts: number
}

/** A successfully claimed job. `leaseToken` fences later completion;
 *  `idempotencyKey` is handed to the handler so it can pass it through to an
 *  external provider for exactly-once side effects. */
export type ClaimedJob = ClaimableJob & { leaseToken: string; idempotencyKey: string | null }

/**
 * Read due pending jobs (scheduled_for ≤ now), oldest first. System read across
 * ALL orgs — intended to run as the base (BYPASSRLS) connection, same as
 * rc-sync's `selectDueRcSyncJobs`. NOT `FOR UPDATE`; the atomic `claimJob` is
 * the concurrency guard.
 */
export async function selectDueJobs(db: DbHandle, limit: number): Promise<ClaimableJob[]> {
  return db
    .select({
      id: backgroundJobs.id,
      organizationId: backgroundJobs.organizationId,
      type: backgroundJobs.type,
      payload: backgroundJobs.payload,
      attempts: backgroundJobs.attempts,
      maxAttempts: backgroundJobs.maxAttempts,
    })
    .from(backgroundJobs)
    .where(and(eq(backgroundJobs.status, "pending"), lte(backgroundJobs.scheduledFor, sql`now()`)))
    .orderBy(asc(backgroundJobs.scheduledFor))
    .limit(limit)
}

/**
 * Atomically claim a due pending job: pending → running, take the lease, bump
 * attempts. Returns the claimed row (incl. the incremented `attempts` and the
 * `leaseToken` to fence later completion) iff THIS caller won, else null (a
 * concurrent worker took it, or it's no longer pending/due). The
 * `WHERE status='pending' … RETURNING` is the exactly-one-worker guard,
 * mirroring rc-sync `claimRcSyncJob`.
 *
 * `attempts` is bumped at CLAIM (not only on failure) so a poison job that
 * crashes the worker every time — never reaching markFailed — still exhausts
 * its retries and dies via the reaper, rather than looping forever.
 */
export async function claimJob(
  tx: DbHandle,
  id: string,
  leaseToken: string,
): Promise<ClaimedJob | null> {
  const rows = await tx
    .update(backgroundJobs)
    .set({
      status: "running",
      leaseToken,
      leaseExpiresAt: dbSecondsFromNow(LEASE_DURATION_SECONDS),
      attempts: sql`${backgroundJobs.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(backgroundJobs.id, id),
        eq(backgroundJobs.status, "pending"),
        lte(backgroundJobs.scheduledFor, sql`now()`),
      ),
    )
    .returning({
      id: backgroundJobs.id,
      organizationId: backgroundJobs.organizationId,
      type: backgroundJobs.type,
      payload: backgroundJobs.payload,
      attempts: backgroundJobs.attempts,
      maxAttempts: backgroundJobs.maxAttempts,
      idempotencyKey: backgroundJobs.idempotencyKey,
      leaseToken: backgroundJobs.leaseToken,
    })
  const row = rows[0]
  if (row?.leaseToken == null) return null
  return { ...row, leaseToken: row.leaseToken }
}

/**
 * Mark a claimed job done. FENCED by `leaseToken`: if the lease was already
 * reclaimed by the reaper (this worker overran), the token no longer matches →
 * 0 rows → returns false, and the caller must treat its side effect as
 * possibly-superseded (the reclaiming worker owns completion now). Idempotent
 * handlers make that safe.
 */
export async function markJobDone(tx: DbHandle, id: string, leaseToken: string): Promise<boolean> {
  const rows = await tx
    .update(backgroundJobs)
    .set({
      status: "done",
      completedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.leaseToken, leaseToken)))
    .returning({ id: backgroundJobs.id })
  return rows.length > 0
}

/**
 * Mark a claimed job failed (a HANDLED error, not a crash). FENCED by
 * `leaseToken`. Re-schedules with backoff, or moves to 'dead' once
 * `currentAttempts` (the post-claim attempt count) has reached `maxAttempts`.
 * Returns `{ ok, dead }` — `ok=false` means the lease was already reclaimed.
 */
export async function markJobFailed(
  tx: DbHandle,
  id: string,
  leaseToken: string,
  currentAttempts: number,
  maxAttempts: number,
  error: string,
): Promise<{ ok: boolean; dead: boolean }> {
  const dead = currentAttempts >= maxAttempts
  const rows = await tx
    .update(backgroundJobs)
    .set(
      dead
        ? {
            status: "dead",
            lastError: error.slice(0, 1000),
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          }
        : {
            status: "pending",
            lastError: error.slice(0, 1000),
            scheduledFor: dbSecondsFromNow(backoffSecondsForAttempt(currentAttempts)),
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          },
    )
    .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.leaseToken, leaseToken)))
    .returning({ id: backgroundJobs.id })
  return { ok: rows.length > 0, dead }
}

export interface ReapResult {
  requeued: number
  dead: number
}

/**
 * Reaper: reclaim rows stranded in 'running' past their lease (a crashed or
 * hung worker). Under the cap → back to 'pending' with backoff; at/over the cap
 * → 'dead'. Two UPDATEs, both keyed on the expired-lease predicate. Intended to
 * run as the base (BYPASSRLS) connection so it sweeps every org in one pass
 * (like `selectDueJobs`); a caller passing an org-scoped handle reaps only that
 * org (fine for tests).
 */
export async function reapExpiredLeases(db: DbHandle): Promise<ReapResult> {
  const expired = and(
    eq(backgroundJobs.status, "running"),
    lte(backgroundJobs.leaseExpiresAt, sql`now()`),
  )

  const dead = await db
    .update(backgroundJobs)
    .set({
      status: "dead",
      lastError: sql`COALESCE(${backgroundJobs.lastError}, 'lease expired — retries exhausted')`,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(expired, sql`${backgroundJobs.attempts} >= ${backgroundJobs.maxAttempts}`))
    .returning({ id: backgroundJobs.id })

  const requeued = await db
    .update(backgroundJobs)
    .set({
      status: "pending",
      lastError: sql`COALESCE(${backgroundJobs.lastError}, 'lease expired (worker crash/hang) — requeued')`,
      // Backoff by the attempt count already recorded at claim.
      scheduledFor: sql`now() + make_interval(secs => LEAST(GREATEST(${backgroundJobs.attempts}, 1) * 30, 900))`,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(expired, sql`${backgroundJobs.attempts} < ${backgroundJobs.maxAttempts}`))
    .returning({ id: backgroundJobs.id })

  return { requeued: requeued.length, dead: dead.length }
}
