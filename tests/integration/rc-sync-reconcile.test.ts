/**
 * Integration tests for the rc-sync reconciliation engine + job queue (Build 2).
 * Real Postgres; reconcile runs under an org context (set_config), matching the
 * worker's per-job tx.
 */
import { describe, it, expect } from "vitest"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { callLog } from "@/modules/calls/schema"
import { reconcileCallRecord } from "@/modules/rc-sync/reconcile"
import {
  enqueueRcSyncJob,
  claimRcSyncJob,
  markRcSyncJobFailed,
  markRcSyncJobDone,
} from "@/modules/rc-sync/queries"
import { rcSyncJobs } from "@/modules/rc-sync/schema"
import type { RcCallLogRecord } from "@/lib/ringcentral/types"

type Db = Parameters<typeof setOrgContext>[0]

const FIXED_CREATED_AT = new Date("2026-06-01T09:00:00Z")

async function seedWitnessedCall(
  db: Db,
  orgId: string,
  userId: string,
  fields: {
    telephonySessionId?: string | null
    rcCallId?: string | null
    rcLastModifiedTime?: Date | null
  },
): Promise<string> {
  const id = createId()
  await db.insert(callLog).values({
    id,
    organizationId: orgId,
    userId,
    direction: "outgoing",
    disposition: "no_answer",
    dispositionSource: "heuristic",
    startedAt: new Date("2026-06-14T12:00:00Z"),
    durationSeconds: 4,
    source: "ringcentral",
    telephonySessionId: fields.telephonySessionId ?? null,
    rcCallId: fields.rcCallId ?? null,
    rcLastModifiedTime: fields.rcLastModifiedTime ?? null,
    createdAt: FIXED_CREATED_AT,
    externalMetadata: { phoneNumber: "7275551234" },
  })
  return id
}

function rcRecord(over: Partial<RcCallLogRecord>): RcCallLogRecord {
  return {
    id: "rc-1",
    startTime: "2026-06-14T12:00:01Z",
    duration: 120,
    direction: "Outbound",
    result: "Call connected",
    lastModifiedTime: "2026-06-14T12:01:00Z",
    to: { phoneNumber: "7275551234" },
    ...over,
  }
}

describe("reconcileCallRecord", () => {
  it("Rule 0: precise session match overwrites the witnessed row with RC truth, keeps created_at", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const rowId = await seedWitnessedCall(db, orgId, userId, { telephonySessionId: "ts-1" })

      const out = await reconcileCallRecord(db, orgId, rcRecord({ id: "rc-1" }), {
        telephonySessionId: "ts-1",
      })
      expect(out.outcome).toBe("update_session")
      expect(out.callLogId).toBe(rowId)

      const [row] = await db.select().from(callLog).where(eq(callLog.id, rowId))
      expect(row?.rcCallId).toBe("rc-1")
      expect(row?.disposition).toBe("completed")
      expect(row?.dispositionSource).toBe("rc_authoritative")
      expect(row?.durationSeconds).toBe(120)
      expect(row?.createdAt.getTime()).toBe(FIXED_CREATED_AT.getTime())
    })
  })

  it("Rule 0 no match → Rule 3 inserts a new rc_sync row", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const out = await reconcileCallRecord(db, orgId, rcRecord({ id: "rc-new" }), {
        telephonySessionId: "ts-absent",
      })
      expect(out.outcome).toBe("insert_no_match")

      const rows = await db
        .select()
        .from(callLog)
        .where(and(eq(callLog.organizationId, orgId), eq(callLog.rcCallId, "rc-new")))
      expect(rows.length).toBe(1)
      expect(rows[0]?.source).toBe("rc_sync")
      expect(rows[0]?.dispositionSource).toBe("rc_authoritative")
    })
  })

  it("Rule 1 monotonicity: a stale lastModifiedTime is skipped; a newer one updates", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const rowId = await seedWitnessedCall(db, orgId, userId, {
        rcCallId: "rc-2",
        rcLastModifiedTime: new Date("2026-06-14T12:05:00Z"),
      })

      // Stale (older lastModifiedTime) → skipped.
      const stale = await reconcileCallRecord(
        db,
        orgId,
        rcRecord({ id: "rc-2", result: "Voicemail", lastModifiedTime: "2026-06-14T12:00:00Z" }),
      )
      expect(stale.outcome).toBe("skip_stale_rc_call_id")
      const [afterStale] = await db.select().from(callLog).where(eq(callLog.id, rowId))
      expect(afterStale?.disposition).toBe("no_answer") // unchanged

      // Newer → applied.
      const fresh = await reconcileCallRecord(
        db,
        orgId,
        rcRecord({ id: "rc-2", result: "Voicemail", lastModifiedTime: "2026-06-14T12:10:00Z" }),
      )
      expect(fresh.outcome).toBe("update_rc_call_id")
      const [afterFresh] = await db.select().from(callLog).where(eq(callLog.id, rowId))
      expect(afterFresh?.disposition).toBe("voicemail")
    })
  })
})

describe("rc-sync job queue", () => {
  it("claim is atomic (second claim of the same job fails) and done marks completed", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const jobId = await enqueueRcSyncJob(db, {
        organizationId: orgId,
        kind: "call_log",
        telephonySessionId: "ts-1",
      })

      expect(await claimRcSyncJob(db, jobId)).toBe(true)
      expect(await claimRcSyncJob(db, jobId)).toBe(false) // already running

      await markRcSyncJobDone(db, jobId)
      const [job] = await db.select().from(rcSyncJobs).where(eq(rcSyncJobs.id, jobId))
      expect(job?.status).toBe("done")
      expect(job?.completedAt).not.toBeNull()
    })
  })

  it("backoff re-schedules pending until the cap, then marks dead", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const jobId = await enqueueRcSyncJob(db, {
        organizationId: orgId,
        kind: "call_log",
        telephonySessionId: "ts-1",
      })

      const r1 = await markRcSyncJobFailed(db, jobId, 0, "not ready")
      expect(r1.dead).toBe(false)
      const [afterFail] = await db.select().from(rcSyncJobs).where(eq(rcSyncJobs.id, jobId))
      expect(afterFail?.status).toBe("pending")
      expect(afterFail?.attempts).toBe(1)

      const r2 = await markRcSyncJobFailed(db, jobId, 9, "still not ready")
      expect(r2.dead).toBe(true)
      const [afterDead] = await db.select().from(rcSyncJobs).where(eq(rcSyncJobs.id, jobId))
      expect(afterDead?.status).toBe("dead")
      expect(afterDead?.attempts).toBe(10)
    })
  })
})
