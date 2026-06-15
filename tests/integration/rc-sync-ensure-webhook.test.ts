/**
 * ensureWebhookSubscription — create-then-renew lifecycle + persistence.
 *
 * MACHINE context: the access token is fetched tx-bound via
 * `getValidAccessToken(args, tx)` (no request ALS) and the RC client is built
 * from it via `ringCentralClientWithToken` — same discipline as the worker.
 * Only the RC HTTP is mocked; the token fetch + the connection-row UPDATE run
 * for real against the seeded connection.
 *
 * `@/lib/env` is mocked so the (optional) verification token is present;
 * everything else on env is preserved from the real validated config.
 */
import { describe, it, expect, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { encrypt } from "@/lib/crypto"
import { telephonyConnections } from "@/modules/telephony/schema"

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal()
  const mod = actual as { env: Record<string, unknown> }
  return {
    ...(actual as object),
    env: { ...mod.env, RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN: "verif-tok" },
  }
})

// MACHINE client returns canned subscription responses (no HTTP). The
// REQUEST-context factory throws so a regression that uses it fails loudly.
vi.mock("@/lib/ringcentral/client", () => ({
  ringCentralClientWithToken: () => ({
    subscribeWebhook: () => Promise.resolve({ id: "sub-new", status: "Active" }),
    renewWebhook: () => Promise.resolve({ id: "sub-new", status: "Active" }),
  }),
  ringCentralClientForUser: () => {
    throw new Error("webhook subscription must NOT use the request-context client factory")
  },
  RingCentralApiError: class RingCentralApiError extends Error {
    constructor(
      readonly status: number,
      readonly body: string,
    ) {
      super(`RingCentral API error ${String(status)}`)
    }
  },
}))

import { ensureWebhookSubscription } from "@/modules/rc-sync/webhook-subscription"

type Db = Parameters<typeof setOrgContext>[0]

async function seedConnection(db: Db, orgId: string, userId: string) {
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
}

describe("ensureWebhookSubscription", () => {
  it("creates a subscription and persists its id, then renews on re-run", async () => {
    await withTestDb(async (db: Db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      await seedConnection(db, orgId, userId)

      const created = await ensureWebhookSubscription(db, { organizationId: orgId, userId })
      expect(created.action).toBe("created")
      expect(created.subscriptionId).toBe("sub-new")

      const [row] = await db
        .select({ subId: telephonyConnections.webhookSubscriptionId })
        .from(telephonyConnections)
        .where(eq(telephonyConnections.organizationId, orgId))
      expect(row?.subId).toBe("sub-new")

      // Second run sees the stored id → renew path.
      const renewed = await ensureWebhookSubscription(db, { organizationId: orgId, userId })
      expect(renewed.action).toBe("renewed")
      expect(renewed.subscriptionId).toBe("sub-new")
    })
  })

  it("skips when there is no live RC connection", async () => {
    await withTestDb(async (db: Db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const res = await ensureWebhookSubscription(db, { organizationId: orgId, userId })
      expect(res.action).toBe("skipped")
      expect(res.reason).toBe("no_connection")
    })
  })
})
