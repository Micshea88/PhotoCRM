/**
 * The durable queue's RUNNER, proven with REAL committed transactions across
 * connections — the strengthening the single-transaction state-machine test
 * (background-jobs-queue.test.ts) explicitly can't do.
 *
 * A worker claims a job in its OWN committed transaction, performs the external
 * side effect (a client email), and then CRASHES before markDone. Because the
 * claim committed, a fresh read sees the row durably 'running' — exactly the
 * state a real process death leaves. The reaper (running on a BYPASSRLS
 * connection, as in prod) reclaims it and the real runner re-runs the handler;
 * because the handler passes the job's idempotency key through to the side
 * effect (modelling the provider's dedup), the client still gets EXACTLY ONE
 * email.
 *
 * Uses a superuser pool with real COMMIT/teardown (pattern: token-refresh
 * integration) — the bypass connection mirrors prod's base `db` (neondb_owner),
 * which the cross-org reaper + poll run on; per-job work still drops into
 * app_authenticated inside the runner.
 */
import { describe, it, expect } from "vitest"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { eq, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import * as schema from "@/db/schema"
import { backgroundJobs } from "@/modules/jobs/queue/schema"
import { enqueueJob, claimJob } from "@/modules/jobs/queue/queries"
import { processDueJobs, type HandlerRegistry } from "@/modules/jobs/queue/runner"

/**
 * A BYPASSRLS (superuser) connection string. Mirrors prod's base connection
 * (neondb_owner) that the cross-org reaper/poll run on. In CI `DATABASE_URL` is
 * already `postgres`; in dev it's the app role, so swap in the superuser.
 */
function bypassUrl(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required for integration tests")
  const u = new URL(raw)
  u.username = "postgres"
  u.password = "postgres"
  return u.toString()
}

function makeIdempotentEffect() {
  const performed = new Set<string>()
  let count = 0
  return {
    perform(key: string): void {
      if (performed.has(key)) return // provider dedups the redelivery
      performed.add(key)
      count += 1
    },
    get count(): number {
      return count
    },
  }
}

describe("background_jobs — real-commit crash recovery via the runner", () => {
  it("crash after side effect → committed 'running' → reaper + runner → exactly one effect", async () => {
    const pool = new Pool({ connectionString: bypassUrl(), max: 5 })
    const db = drizzle(pool, { schema })
    const userId = createId()
    const orgId = createId()
    const effect = makeIdempotentEffect()
    const key = "evt-real-commit"

    try {
      // ── Seed (committed) — auth tables have no RLS. ──
      await db
        .insert(schema.user)
        .values({
          id: userId,
          name: "T",
          email: `${userId.slice(0, 8)}@ex.com`,
          emailVerified: true,
        })
      await db
        .insert(schema.organization)
        .values({ id: orgId, name: "O", slug: `o-${orgId.slice(0, 8)}`, createdAt: new Date() })
      await db
        .insert(schema.member)
        .values({
          id: createId(),
          organizationId: orgId,
          userId,
          role: "owner",
          createdAt: new Date(),
        })

      // Producer enqueues (committed).
      const { id, enqueued } = await enqueueJob(db, {
        organizationId: orgId,
        type: "test_effect",
        idempotencyKey: key,
        payload: { key },
      })
      expect(enqueued).toBe(true)

      // WORKER A: claim in its own COMMITTED transaction, perform the side
      // effect, then "crash" — abandon without markDone.
      const claimedA = await db.transaction((tx) => claimJob(tx, id, "lease-A"))
      expect(claimedA).not.toBeNull()
      effect.perform(claimedA!.idempotencyKey!) // the client email goes out
      // ← process dies here. No markDone. The claim is durably committed.

      // A fresh read sees the row durably 'running' — exactly the state a real
      // crash leaves behind (this is what the single-tx test can't show).
      const [durable] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id))
      expect(durable?.status).toBe("running")
      expect(durable?.attempts).toBe(1)

      // The lease expires (clock advances past lease_expires_at).
      await db
        .update(backgroundJobs)
        .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
        .where(eq(backgroundJobs.id, id))

      // The real runner reaps the stranded row (→ pending with backoff).
      const handlers: HandlerRegistry = {
        // eslint-disable-next-line @typescript-eslint/require-await
        test_effect: async (_tx, job) => {
          effect.perform(job.idempotencyKey ?? "")
        },
      }
      const drain1 = await processDueJobs(handlers, { db })
      expect(drain1.reaped.requeued).toBe(1)
      expect(drain1.processed).toBe(0) // backoff pushed scheduled_for into the future

      // The clock reaches the retry time; the runner claims + runs + completes.
      await db
        .update(backgroundJobs)
        .set({ scheduledFor: sql`now()` })
        .where(eq(backgroundJobs.id, id))
      const drain2 = await processDueJobs(handlers, { db })
      expect(drain2.done).toBe(1)

      // The proof: exactly ONE client email across the crash + recovery, and the
      // job is durably done.
      expect(effect.count).toBe(1)
      const [final] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id))
      expect(final?.status).toBe("done")
      expect(final?.attempts).toBe(2) // claimed twice: worker A + the reclaim
    } finally {
      // FK-ordered teardown of committed rows (best-effort).
      try {
        await db.delete(backgroundJobs).where(eq(backgroundJobs.organizationId, orgId))
      } catch {
        /* ignore */
      }
      try {
        await db.delete(schema.member).where(eq(schema.member.organizationId, orgId))
      } catch {
        /* ignore */
      }
      try {
        await db.delete(schema.organization).where(eq(schema.organization.id, orgId))
      } catch {
        /* ignore */
      }
      try {
        await db.delete(schema.user).where(eq(schema.user.id, userId))
      } catch {
        /* ignore */
      }
      await pool.end()
    }
  })
})
