import { describe, it, expect } from "vitest"
import { setOrgContext, withTestDb } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { upsertRingCentralConnection } from "@/modules/telephony/upsert"
import { disconnectTelephonyImpl } from "@/modules/telephony/disconnect"
import {
  listConnectedProvidersForOrgImpl,
  listConnectedProvidersForUserImpl,
  userHasConnectedPhoneProviderImpl,
} from "@/modules/telephony/queries"
import type { RingCentralTokenResponse } from "@/modules/telephony/ringcentral-oauth"

/**
 * Telephony Step 2 — connected-providers query proofs.
 *
 * Each query has both a public wrapper (`withOrgContext` reads ALS —
 * what server components call) and an `Impl` variant that accepts a
 * tx directly. The Impls are the single source of truth; the public
 * wrappers add only the ALS-to-tx plumbing.
 *
 * These tests drive the Impl variants against the test's
 * BEGIN/ROLLBACK transaction, mirroring how
 * tests/integration/custom-fields-host-helpers-org-context.test.ts
 * tests the host helpers against a `withTestDb` + `setOrgContext`
 * transaction.
 *
 * Coverage:
 *   (a) listConnectedProvidersForOrg returns ALL live connections
 *       in the current org (every user).
 *   (b) listConnectedProvidersForUser is per-user; orgB-side row
 *       absent under a SELECT for a different user.
 *   (c) userHasConnectedPhoneProvider is per-user — the wrong-scope
 *       bug we hit in the wizard would have been caught by this.
 *   (d) Soft-deleted (disconnected) row does NOT count toward
 *       userHasConnectedPhoneProvider.
 *   (e) Cross-org RLS — same user, different org, returns false.
 *   (f) tel: is structurally absent — it has connectKind="none" and
 *       the upsert layer never writes it (only "ringcentral" is
 *       written). No fixture can produce a tel: row, so no test
 *       asserts it directly; the invariant lives in the registry +
 *       upsert.ts contract.
 */

const FIXTURE_TOKENS: RingCentralTokenResponse = {
  access_token: "ACCESS_PLAINTEXT_q_001",
  refresh_token: "REFRESH_PLAINTEXT_q_001",
  expires_in: 3600,
  refresh_token_expires_in: 604800,
  scope: "ReadCallLog ReadMessages SMS VoipCalling",
  owner_id: "rc_ext_q_001",
}

describe("connected providers — listConnectedProvidersForOrg returns ALL users", () => {
  it("returns both userA and userB's rows for the current org", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      await upsertRingCentralConnection(db, {
        organizationId: orgId,
        userId: userA,
        tokens: { ...FIXTURE_TOKENS, owner_id: "rc_ext_userA" },
      })
      await upsertRingCentralConnection(db, {
        organizationId: orgId,
        userId: userB,
        tokens: { ...FIXTURE_TOKENS, owner_id: "rc_ext_userB" },
      })

      const rows = await listConnectedProvidersForOrgImpl(db)
      expect(rows.length).toBe(2)
      const byUser = new Map(rows.map((r) => [r.userId, r]))
      expect(byUser.has(userA)).toBe(true)
      expect(byUser.has(userB)).toBe(true)
      expect(byUser.get(userA)?.provider).toBe("ringcentral")
      expect(byUser.get(userB)?.provider).toBe("ringcentral")
      expect(byUser.get(userA)?.externalUserId).toBe("rc_ext_userA")
      expect(byUser.get(userB)?.externalUserId).toBe("rc_ext_userB")
    })
  })
})

describe("connected providers — listConnectedProvidersForUser is per-user", () => {
  it("under userA's query, returns 1 row (userA's) and explicitly NOT userB's row id", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      const connA = await upsertRingCentralConnection(db, {
        organizationId: orgId,
        userId: userA,
        tokens: FIXTURE_TOKENS,
      })
      const connB = await upsertRingCentralConnection(db, {
        organizationId: orgId,
        userId: userB,
        tokens: FIXTURE_TOKENS,
      })

      const aOnly = await listConnectedProvidersForUserImpl(db, userA)
      expect(aOnly.length).toBe(1)
      const [first] = aOnly
      if (!first) throw new Error("expected exactly one connection row for userA")
      expect(first.id).toBe(connA.id)
      // Explicit: userB's row id must NOT appear in userA's per-user list.
      expect(aOnly.map((r) => r.id)).not.toContain(connB.id)
    })
  })
})

describe("connected providers — userHasConnectedPhoneProvider per-user", () => {
  it("true for connected user, false for unconnected user (wrong-scope-bug regression test)", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      // Only userA gets connected.
      await upsertRingCentralConnection(db, {
        organizationId: orgId,
        userId: userA,
        tokens: FIXTURE_TOKENS,
      })

      expect(await userHasConnectedPhoneProviderImpl(db, userA)).toBe(true)
      expect(await userHasConnectedPhoneProviderImpl(db, userB)).toBe(false)
    })
  })
})

describe("connected providers — soft-deleted row does NOT count", () => {
  it("after disconnect, userHasConnectedPhoneProvider returns false", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      await upsertRingCentralConnection(db, {
        organizationId: orgId,
        userId: userA,
        tokens: FIXTURE_TOKENS,
      })
      expect(await userHasConnectedPhoneProviderImpl(db, userA)).toBe(true)

      await disconnectTelephonyImpl(db, {
        organizationId: orgId,
        userId: userA,
        provider: "ringcentral",
        actorUserId: userA,
      })
      expect(await userHasConnectedPhoneProviderImpl(db, userA)).toBe(false)
    })
  })
})

describe("connected providers — cross-org RLS", () => {
  it("same user connected in orgA — under orgB RLS context, userHasConnectedPhoneProvider returns false", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const orgB = await createOrganization(db, userA)

      // Connect userA in orgA only.
      await setOrgContext(db, orgA, "owner", userA)
      await upsertRingCentralConnection(db, {
        organizationId: orgA,
        userId: userA,
        tokens: FIXTURE_TOKENS,
      })

      // Under orgA's context — true.
      expect(await userHasConnectedPhoneProviderImpl(db, userA)).toBe(true)

      // Switch RLS context to orgB — same user, different org. RLS
      // policy filters by app.current_org GUC; the user's orgA row
      // is invisible from this context.
      await setOrgContext(db, orgB, "owner", userA)
      expect(await userHasConnectedPhoneProviderImpl(db, userA)).toBe(false)

      // And listConnectedProvidersForOrg under orgB returns 0.
      const orgBRows = await listConnectedProvidersForOrgImpl(db)
      expect(orgBRows.length).toBe(0)
    })
  })
})
