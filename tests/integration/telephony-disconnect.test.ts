import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { withRawClient } from "../helpers/rls"
import { ActionError } from "@/lib/safe-action"
import { disconnectTelephonyImpl } from "@/modules/telephony/disconnect"
import { upsertRingCentralConnection } from "@/modules/telephony/upsert"
import type { RingCentralTokenResponse } from "@/modules/telephony/ringcentral-oauth"
import * as schema from "@/db/schema"

/**
 * Telephony Step 2 — disconnect proofs.
 *
 * The action `disconnectTelephony` (src/modules/telephony/actions.ts)
 * is a thin orgAction wrapper: role check + role-switched tx +
 * revalidatePath. Its SQL+audit body lives in
 * src/modules/telephony/disconnect.ts as `disconnectTelephonyImpl`,
 * which is what these tests exercise — single source of truth, no
 * hand-copied SQL that could drift.
 *
 * The wrapping role check + auth middleware are out of scope for
 * this integration suite (they require a Next session). What's
 * covered:
 *
 *   (a) Soft-delete only — row count unchanged, deletedAt/deletedBy set.
 *   (b) Audit row written with action + metadata + actor.
 *   (c) Partial-unique allows reconnect via upsertRingCentralConnection.
 *   (d) NOT_FOUND when no live row exists OR a double-disconnect.
 *
 * Pattern mirrors Step 1: every test inside one withRawClient
 * BEGIN/ROLLBACK; Drizzle handle wraps the SAME PoolClient so
 * disconnectTelephonyImpl's writes commit/rollback with the seed.
 */

const FIXTURE_TOKENS: RingCentralTokenResponse = {
  access_token: "ACCESS_PLAINTEXT_disconnect_001",
  refresh_token: "REFRESH_PLAINTEXT_disconnect_001",
  expires_in: 3600,
  refresh_token_expires_in: 604800,
  scope: "ReadCallLog ReadMessages SMS VoipCalling",
  owner_id: "rc_ext_disc_001",
}

async function seedOrgAndUser(client: PoolClient) {
  const orgId = createId()
  const userId = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'Org Disc', $2, NOW())`,
    [orgId, `orgdisc-${orgId.slice(0, 8)}`],
  )
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Disc User', $2, true, NOW(), NOW())`,
    [userId, `${userId.slice(0, 8)}@example.com`],
  )
  return { orgId, userId }
}

describe("telephony disconnect — soft-delete only, row remains in table", () => {
  it("after disconnect, the (org,user,'ringcentral') row count is still 1 with deletedAt+deletedBy set", async () => {
    await withRawClient(async (client) => {
      const { orgId, userId } = await seedOrgAndUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
      const tx = drizzle(client, { schema })

      const connect = await upsertRingCentralConnection(tx, {
        organizationId: orgId,
        userId,
        tokens: FIXTURE_TOKENS,
      })

      const before = Date.now()
      await disconnectTelephonyImpl(tx, {
        organizationId: orgId,
        userId,
        provider: "ringcentral",
        actorUserId: userId,
      })
      const after = Date.now()

      const countQ = await client.query(
        `SELECT count(*)::int AS n FROM telephony_connections
         WHERE organization_id = $1 AND user_id = $2 AND provider = 'ringcentral'`,
        [orgId, userId],
      )
      const countRow = countQ.rows[0] as { n: number }
      expect(countRow.n).toBe(1)

      const row = (
        await client.query(
          "SELECT deleted_at, deleted_by FROM telephony_connections WHERE id = $1",
          [connect.id],
        )
      ).rows[0] as { deleted_at: Date | null; deleted_by: string | null }

      expect(row.deleted_at).not.toBeNull()
      const delMs = row.deleted_at!.getTime()
      expect(delMs).toBeGreaterThanOrEqual(before)
      expect(delMs).toBeLessThanOrEqual(after + 500)
      expect(row.deleted_by).toBe(userId)
    })
  })
})

describe("telephony disconnect — audit row written", () => {
  it("audit_log has telephony.disconnected with provider=ringcentral, actorUserId=userId, organizationId=orgId", async () => {
    await withRawClient(async (client) => {
      const { orgId, userId } = await seedOrgAndUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
      const tx = drizzle(client, { schema })

      const connect = await upsertRingCentralConnection(tx, {
        organizationId: orgId,
        userId,
        tokens: FIXTURE_TOKENS,
      })
      await disconnectTelephonyImpl(tx, {
        organizationId: orgId,
        userId,
        provider: "ringcentral",
        actorUserId: userId,
      })

      const auditRows = (
        await client.query(
          `SELECT action, actor_user_id, organization_id, resource_type,
                  resource_id, metadata
           FROM audit_log
           WHERE organization_id = $1 AND action = 'telephony.disconnected'`,
          [orgId],
        )
      ).rows as {
        action: string
        actor_user_id: string
        organization_id: string
        resource_type: string | null
        resource_id: string | null
        metadata: { provider?: string } | null
      }[]

      expect(auditRows.length).toBe(1)
      const [a] = auditRows
      if (!a) throw new Error("expected exactly one audit row")
      expect(a.action).toBe("telephony.disconnected")
      expect(a.actor_user_id).toBe(userId)
      expect(a.organization_id).toBe(orgId)
      expect(a.resource_type).toBe("telephony_connection")
      expect(a.resource_id).toBe(connect.id)
      expect(a.metadata?.provider).toBe("ringcentral")
    })
  })
})

describe("telephony disconnect — partial-unique allows reconnect", () => {
  it("after disconnect, upsertRingCentralConnection reactivates same row id (no duplicate, no unique-index violation)", async () => {
    await withRawClient(async (client) => {
      const { orgId, userId } = await seedOrgAndUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
      const tx = drizzle(client, { schema })

      const first = await upsertRingCentralConnection(tx, {
        organizationId: orgId,
        userId,
        tokens: FIXTURE_TOKENS,
      })
      await disconnectTelephonyImpl(tx, {
        organizationId: orgId,
        userId,
        provider: "ringcentral",
        actorUserId: userId,
      })

      const second = await upsertRingCentralConnection(tx, {
        organizationId: orgId,
        userId,
        tokens: FIXTURE_TOKENS,
      })
      expect(second.reactivated).toBe(true)
      expect(second.id).toBe(first.id)

      const countQ = await client.query(
        `SELECT count(*)::int AS n FROM telephony_connections
         WHERE organization_id = $1 AND user_id = $2 AND provider = 'ringcentral'`,
        [orgId, userId],
      )
      const countRow = countQ.rows[0] as { n: number }
      expect(countRow.n).toBe(1)

      const final = (
        await client.query(
          "SELECT deleted_at, deleted_by FROM telephony_connections WHERE id = $1",
          [first.id],
        )
      ).rows[0] as { deleted_at: Date | null; deleted_by: string | null }
      expect(final.deleted_at).toBeNull()
      expect(final.deleted_by).toBeNull()
    })
  })
})

describe("telephony disconnect — NOT_FOUND when no live row exists", () => {
  it("disconnect on (org,user,provider) with no live row throws ActionError NOT_FOUND", async () => {
    await withRawClient(async (client) => {
      const { orgId, userId } = await seedOrgAndUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
      const tx = drizzle(client, { schema })

      await expect(
        disconnectTelephonyImpl(tx, {
          organizationId: orgId,
          userId,
          provider: "ringcentral",
          actorUserId: userId,
        }),
      ).rejects.toThrow(ActionError)
      await expect(
        disconnectTelephonyImpl(tx, {
          organizationId: orgId,
          userId,
          provider: "ringcentral",
          actorUserId: userId,
        }),
      ).rejects.toThrow(/no active connection/i)
    })
  })

  it("double-disconnect on the same row also throws NOT_FOUND (already soft-deleted)", async () => {
    await withRawClient(async (client) => {
      const { orgId, userId } = await seedOrgAndUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
      const tx = drizzle(client, { schema })

      await upsertRingCentralConnection(tx, {
        organizationId: orgId,
        userId,
        tokens: FIXTURE_TOKENS,
      })
      await disconnectTelephonyImpl(tx, {
        organizationId: orgId,
        userId,
        provider: "ringcentral",
        actorUserId: userId,
      })
      await expect(
        disconnectTelephonyImpl(tx, {
          organizationId: orgId,
          userId,
          provider: "ringcentral",
          actorUserId: userId,
        }),
      ).rejects.toThrow(ActionError)
    })
  })
})
