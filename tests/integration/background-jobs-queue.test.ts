/**
 * The generic durable job queue (`background_jobs`) — the locked pattern:
 * atomic claim, lease + reaper, fencing, capped-backoff DLQ, idempotent enqueue.
 *
 * The headline test is CRASH-RECOVER: a worker performs the external side
 * effect (a client email) and then dies BEFORE marking the job done. The reaper
 * reclaims the stranded row, a second worker re-runs the handler, and because
 * the side effect is idempotent (keyed by the job's idempotency key, modelling
 * the provider's dedup) the client still gets EXACTLY ONE email. This is the
 * guarantee rc-sync's single-transaction model can't give for external effects.
 */
import { describe, it, expect } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { backgroundJobs } from "@/modules/jobs/queue/schema"
import {
  enqueueJob,
  selectDueJobs,
  claimJob,
  markJobDone,
  markJobFailed,
  reapExpiredLeases,
} from "@/modules/jobs/queue/queries"

/**
 * Models an external side effect (a client email) with the provider's
 * idempotency dedup: the effect runs at most once per key, however many times
 * the handler is invoked. The in-test store survives the simulated crash the
 * same way the provider's dedup survives it in production.
 */
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

async function forceExpireLease(db: Parameters<Parameters<typeof withTestDb>[0]>[0], id: string) {
  await db
    .update(backgroundJobs)
    .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
    .where(eq(backgroundJobs.id, id))
}

async function forceDue(db: Parameters<Parameters<typeof withTestDb>[0]>[0], id: string) {
  await db
    .update(backgroundJobs)
    .set({ scheduledFor: sql`now()` })
    .where(eq(backgroundJobs.id, id))
}

describe("background_jobs — durable queue", () => {
  it("crash AFTER the side effect → reaper reclaims → still exactly one effect", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const effect = makeIdempotentEffect()
      const key = "evt-crash-123"

      const { id, enqueued } = await enqueueJob(db, {
        organizationId: orgId,
        type: "test_effect",
        idempotencyKey: key,
        payload: { key },
      })
      expect(enqueued).toBe(true)

      // Worker 1: claim, perform the side effect, then CRASH before markDone.
      const [due1] = await selectDueJobs(db, 10)
      expect(due1?.id).toBe(id)
      const claim1 = await claimJob(db, id, "lease-1")
      expect(claim1).not.toBeNull()
      effect.perform(key) // the client email goes out
      // ← process dies here. markJobDone is never called; the row stays 'running'.

      // The lease expires; the reaper reclaims the stranded row.
      await forceExpireLease(db, id)
      const reap = await reapExpiredLeases(db)
      expect(reap).toEqual({ requeued: 1, dead: 0 })
      const [afterReap] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id))
      expect(afterReap?.status).toBe("pending")

      // Worker 2: re-claim (backoff pushed scheduled_for out; the clock caught
      // up), re-run the handler, markDone.
      await forceDue(db, id)
      const claim2 = await claimJob(db, id, "lease-2")
      expect(claim2).not.toBeNull()
      effect.perform(key) // idempotent — provider dedups, NO second email
      const done = await markJobDone(db, id, "lease-2")
      expect(done).toBe(true)

      // The proof: exactly one side effect across the crash + retry.
      expect(effect.count).toBe(1)
      const [final] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id))
      expect(final?.status).toBe("done")
      expect(final?.attempts).toBe(2) // claimed twice
    })
  })

  it("claimJob is atomic — a second claim on the same pending job returns null", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const { id } = await enqueueJob(db, { organizationId: orgId, type: "test_effect" })
      const first = await claimJob(db, id, "lease-a")
      const second = await claimJob(db, id, "lease-b")
      expect(first).not.toBeNull()
      expect(second).toBeNull() // already running → WHERE status='pending' matches 0 rows
      expect(first?.attempts).toBe(1)
    })
  })

  it("enqueueJob dedups on idempotencyKey — redelivery is a no-op", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const a = await enqueueJob(db, {
        organizationId: orgId,
        type: "inbound_email",
        idempotencyKey: "k",
      })
      const b = await enqueueJob(db, {
        organizationId: orgId,
        type: "inbound_email",
        idempotencyKey: "k",
      })
      expect(a.enqueued).toBe(true)
      expect(b.enqueued).toBe(false)
      expect(b.id).toBe(a.id)
      const rows = await db
        .select()
        .from(backgroundJobs)
        .where(
          and(eq(backgroundJobs.organizationId, orgId), eq(backgroundJobs.type, "inbound_email")),
        )
      expect(rows).toHaveLength(1)
    })
  })

  it("markJobDone is fenced by leaseToken — a stale worker cannot complete a reclaimed job", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const { id } = await enqueueJob(db, { organizationId: orgId, type: "test_effect" })
      await claimJob(db, id, "lease-real")
      expect(await markJobDone(db, id, "lease-stale")).toBe(false)
      expect(await markJobDone(db, id, "lease-real")).toBe(true)
    })
  })

  it("markJobFailed moves a job to dead once attempts reach maxAttempts", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const { id } = await enqueueJob(db, {
        organizationId: orgId,
        type: "test_effect",
        maxAttempts: 1,
      })
      const claim = await claimJob(db, id, "l1") // attempts → 1
      expect(claim).not.toBeNull()
      const r = await markJobFailed(db, id, "l1", claim!.attempts, claim!.maxAttempts, "boom")
      expect(r).toEqual({ ok: true, dead: true })
      const [row] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id))
      expect(row?.status).toBe("dead")
      expect(row?.lastError).toBe("boom")
    })
  })

  it("reaper moves an expired running job past the cap to dead, not pending", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const { id } = await enqueueJob(db, {
        organizationId: orgId,
        type: "test_effect",
        maxAttempts: 1,
      })
      await claimJob(db, id, "l1") // attempts → 1 (== maxAttempts)
      await forceExpireLease(db, id)
      const reap = await reapExpiredLeases(db)
      expect(reap).toEqual({ requeued: 0, dead: 1 })
      const [row] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id))
      expect(row?.status).toBe("dead")
    })
  })
})
