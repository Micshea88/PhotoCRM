/**
 * Regression guard for the live-test bug: the worker built its RC client via
 * `ringCentralClientForUser`, whose token getter calls `getValidAccessToken`
 * WITHOUT a tx → falls back to `withOrgContext` → throws "no org context in
 * scope" in a job (no request ALS) context.
 *
 * This exercises the FULL worker per-job path (claim → tx-bound token fetch →
 * client build → reconcile → done) WITHOUT establishing a request ALS context
 * (withTestDb sets GUCs but never runWithOrgContext). Only the RC HTTP is
 * mocked; `getValidAccessToken(tx)` runs for real against a seeded connection.
 * If anyone reverts to a no-tx token fetch / the request-context factory, this
 * goes red.
 */
import { describe, it, expect, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { encrypt } from "@/lib/crypto"
import { telephonyConnections } from "@/modules/telephony/schema"
import { callLog } from "@/modules/calls/schema"
import { rcSyncJobs } from "@/modules/rc-sync/schema"

// Hoisted so the (hoisted) vi.mock factory can reference it.
const { FAKE_RECORD } = vi.hoisted(() => ({
  FAKE_RECORD: {
    id: "rc-worker",
    startTime: "2026-06-14T12:00:01Z",
    duration: 46,
    direction: "Outbound",
    result: "Call connected",
    lastModifiedTime: "2026-06-14T12:01:00Z",
    to: { phoneNumber: "7275551234" },
  },
}))

// Mock only the RC client module: the MACHINE factory returns a fake (no HTTP);
// the REQUEST-context factory THROWS so a regression that uses it fails loudly.
vi.mock("@/lib/ringcentral/client", () => ({
  ringCentralClientWithToken: () => ({
    getCallBySessionId: () => Promise.resolve(FAKE_RECORD),
    getCall: () => Promise.resolve(FAKE_RECORD),
  }),
  ringCentralClientForUser: () => {
    throw new Error("worker must NOT use the request-context client factory")
  },
}))

import { runRcSyncJobInTx } from "@/modules/rc-sync/runner"
import { enqueueRcSyncJob } from "@/modules/rc-sync/queries"

type Db = Parameters<typeof setOrgContext>[0]

describe("rc-sync worker — machine context (no request ALS)", () => {
  it("flips a witnessed row to RC truth without 'no org context in scope'", async () => {
    await withTestDb(async (db: Db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      // GUCs only — deliberately NO runWithOrgContext ALS, like the real worker.
      await setOrgContext(db, orgId, "owner", userId)

      // Live RC connection so the tx-bound token fetch returns a token (no HTTP).
      await db.insert(telephonyConnections).values({
        id: createId(),
        organizationId: orgId,
        userId,
        provider: "ringcentral",
        accessToken: encrypt("access-plain"),
        refreshToken: encrypt("refresh-plain"),
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
        scope: "ReadCallLog",
        externalUserId: "ext-1",
      })

      // Witnessed call: heuristic disposition, captured telephony_session_id.
      const rowId = createId()
      await db.insert(callLog).values({
        id: rowId,
        organizationId: orgId,
        userId,
        direction: "outgoing",
        disposition: "completed",
        dispositionSource: "heuristic",
        startedAt: new Date("2026-06-14T12:00:00Z"),
        durationSeconds: 46,
        source: "ringcentral",
        telephonySessionId: "ts-worker",
        externalMetadata: { phoneNumber: "7275551234" },
      })

      const jobId = await enqueueRcSyncJob(db, {
        organizationId: orgId,
        kind: "call_log",
        telephonySessionId: "ts-worker",
      })

      const outcome = await runRcSyncJobInTx(db, {
        id: jobId,
        organizationId: orgId,
        kind: "call_log",
        telephonySessionId: "ts-worker",
        rcCallId: null,
        attempts: 0,
      })

      expect(outcome).toBe("done")

      const [row] = await db.select().from(callLog).where(eq(callLog.id, rowId))
      expect(row?.dispositionSource).toBe("rc_authoritative")
      expect(row?.rcCallId).toBe("rc-worker")

      const [job] = await db.select().from(rcSyncJobs).where(eq(rcSyncJobs.id, jobId))
      expect(job?.status).toBe("done")
    })
  })
})
