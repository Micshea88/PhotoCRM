/**
 * Dedup guard for the two-producer race: the dialer's post-hangup enqueue
 * (Layer 2) and the account webhook (Layer 1) both fire for the same telephony
 * session id. `enqueueIfNoActiveJob` must collapse them to a single active job.
 */
import { describe, it, expect } from "vitest"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { rcSyncJobs } from "@/modules/rc-sync/schema"
import { enqueueIfNoActiveJob, markRcSyncJobDone } from "@/modules/rc-sync/queries"

type Db = Parameters<typeof setOrgContext>[0]

describe("enqueueIfNoActiveJob — dedup", () => {
  it("collapses duplicate (org, kind, session) enqueues while one is active", async () => {
    await withTestDb(async (db: Db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const first = await enqueueIfNoActiveJob(db, {
        organizationId: orgId,
        kind: "call_log",
        telephonySessionId: "ts-1",
      })
      expect(first.enqueued).toBe(true)

      const second = await enqueueIfNoActiveJob(db, {
        organizationId: orgId,
        kind: "call_log",
        telephonySessionId: "ts-1",
      })
      expect(second.enqueued).toBe(false)
      expect(second.id).toBe(first.id)

      // A different session id is a genuinely new job.
      const other = await enqueueIfNoActiveJob(db, {
        organizationId: orgId,
        kind: "call_log",
        telephonySessionId: "ts-2",
      })
      expect(other.enqueued).toBe(true)

      const rows = await db.select().from(rcSyncJobs)
      expect(rows.length).toBe(2)
    })
  })

  it("re-enqueues once the prior job is no longer active (done)", async () => {
    await withTestDb(async (db: Db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const first = await enqueueIfNoActiveJob(db, {
        organizationId: orgId,
        kind: "call_log",
        telephonySessionId: "ts-1",
      })
      await markRcSyncJobDone(db, first.id)

      const second = await enqueueIfNoActiveJob(db, {
        organizationId: orgId,
        kind: "call_log",
        telephonySessionId: "ts-1",
      })
      expect(second.enqueued).toBe(true)
      expect(second.id).not.toBe(first.id)
    })
  })
})
