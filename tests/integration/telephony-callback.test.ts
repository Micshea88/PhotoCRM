import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { withRawClient } from "../helpers/rls"
import { decrypt, encrypt } from "@/lib/crypto"
import { upsertRingCentralConnection } from "@/modules/telephony/upsert"
import type { RingCentralTokenResponse } from "@/modules/telephony/ringcentral-oauth"
import * as schema from "@/db/schema"

/**
 * Telephony Step 2 — callback persistence proofs.
 *
 * State validation rejection (mismatched / tampered / wrong-user) is
 * proved by tests/unit/telephony-pkce.test.ts. These integration tests
 * cover the DB-touching path the callback drives after state validates:
 *
 *   (a) encrypted-at-rest — upsert writes raw v1: ciphertext, never
 *       plaintext; decrypt round-trips back to the input.
 *   (b) reactivation — re-connect updates the existing soft-deleted
 *       (org, user, "ringcentral") row in place, never duplicates.
 *   (c) RLS isolation — orgB's connection id is invisible under orgA's
 *       app.current_org GUC.
 *
 * Pattern mirrors Step 1: every test runs inside a single withRawClient
 * BEGIN/ROLLBACK. The Drizzle handle for the upsert helper wraps the
 * SAME PoolClient so its writes commit/rollback together with the
 * test's seed.
 */

const FIXTURE_TOKENS: RingCentralTokenResponse = {
  access_token: "ACCESS_PLAINTEXT_ringcentral_xyz_001",
  refresh_token: "REFRESH_PLAINTEXT_ringcentral_abc_001",
  expires_in: 3600,
  refresh_token_expires_in: 604800,
  scope: "ReadCallLog ReadMessages SMS VoipCalling",
  owner_id: "rc_ext_12345",
}

async function seedTwoOrgsAndUser(client: PoolClient) {
  const orgA = createId()
  const orgB = createId()
  const userId = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'Org A', $2, NOW()), ($3, 'Org B', $4, NOW())`,
    [orgA, `orga-${orgA.slice(0, 8)}`, orgB, `orgb-${orgB.slice(0, 8)}`],
  )
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Test User', $2, true, NOW(), NOW())`,
    [userId, `${userId.slice(0, 8)}@example.com`],
  )
  return { orgA, orgB, userId }
}

describe("telephony callback — encrypted-at-rest write", () => {
  it("upsertRingCentralConnection stores v1: ciphertext, not plaintext, and decrypts back", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])

      // Wrap the test's PoolClient in a Drizzle handle so the upsert
      // writes happen INSIDE the test's BEGIN/ROLLBACK.
      const tx = drizzle(client, { schema })
      const result = await upsertRingCentralConnection(tx, {
        organizationId: orgA,
        userId,
        tokens: FIXTURE_TOKENS,
      })
      expect(result.reactivated).toBe(false)

      // Read raw columns directly — bypass any decrypt helper.
      const probe = await client.query(
        `SELECT access_token, refresh_token, scope, external_user_id,
                access_token_expires_at, refresh_token_expires_at,
                webhook_subscription_id, validation_token, deleted_at
         FROM telephony_connections WHERE id = $1`,
        [result.id],
      )
      expect(probe.rows.length).toBe(1)
      const row = probe.rows[0] as {
        access_token: string
        refresh_token: string
        scope: string
        external_user_id: string
        access_token_expires_at: Date
        refresh_token_expires_at: Date
        webhook_subscription_id: string | null
        validation_token: string | null
        deleted_at: Date | null
      }

      // Raw columns NOT plaintext + start with v1: prefix.
      expect(row.access_token).not.toBe(FIXTURE_TOKENS.access_token)
      expect(row.refresh_token).not.toBe(FIXTURE_TOKENS.refresh_token)
      expect(row.access_token.startsWith("v1:")).toBe(true)
      expect(row.refresh_token.startsWith("v1:")).toBe(true)
      // Plaintext substring does not appear anywhere in stored values.
      expect(row.access_token).not.toContain(FIXTURE_TOKENS.access_token)
      expect(row.refresh_token).not.toContain(FIXTURE_TOKENS.refresh_token)
      // decrypt round-trips back to plaintext.
      expect(decrypt(row.access_token)).toBe(FIXTURE_TOKENS.access_token)
      expect(decrypt(row.refresh_token)).toBe(FIXTURE_TOKENS.refresh_token)
      // Non-secret columns stored as-is.
      expect(row.scope).toBe(FIXTURE_TOKENS.scope)
      expect(row.external_user_id).toBe(FIXTURE_TOKENS.owner_id)
      // Step-1's webhook-push columns left null this push.
      expect(row.webhook_subscription_id).toBeNull()
      expect(row.validation_token).toBeNull()
      // Row is live.
      expect(row.deleted_at).toBeNull()
    })
  })
})

describe("telephony callback — re-connect reactivates the soft-deleted row", () => {
  it("connect → soft-delete → connect again ⇒ same id, deletedAt null, tokens re-encrypted, scope+externalUserId updated", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])

      const tx = drizzle(client, { schema })

      // 1) First connect
      const first = await upsertRingCentralConnection(tx, {
        organizationId: orgA,
        userId,
        tokens: FIXTURE_TOKENS,
      })
      expect(first.reactivated).toBe(false)

      // Capture first ciphertext so we can later prove re-encryption
      // produced a DIFFERENT ciphertext (IV randomness).
      const before = await client.query(
        "SELECT access_token, refresh_token FROM telephony_connections WHERE id = $1",
        [first.id],
      )
      const beforeRow = before.rows[0] as { access_token: string; refresh_token: string }
      const firstAccessCipher = beforeRow.access_token
      const firstRefreshCipher = beforeRow.refresh_token

      // 2) Soft-delete the row (simulating disconnect)
      await client.query(
        `UPDATE telephony_connections SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1`,
        [first.id, userId],
      )

      // 3) Second connect — fresh OAuth grant with UPDATED tokens.
      const reconnectTokens: RingCentralTokenResponse = {
        ...FIXTURE_TOKENS,
        access_token: "ACCESS_PLAINTEXT_re_connect_999",
        refresh_token: "REFRESH_PLAINTEXT_re_connect_888",
        scope: "ReadCallLog SMS VoipCalling",
        owner_id: "rc_ext_99999",
      }
      const second = await upsertRingCentralConnection(tx, {
        organizationId: orgA,
        userId,
        tokens: reconnectTokens,
      })
      expect(second.reactivated).toBe(true)
      expect(second.id).toBe(first.id) // SAME row — not a duplicate

      // 4) Exactly one row total for this (org, user, "ringcentral").
      const countQ = await client.query(
        `SELECT count(*)::int AS n FROM telephony_connections
         WHERE organization_id = $1 AND user_id = $2 AND provider = 'ringcentral'`,
        [orgA, userId],
      )
      const countRow = countQ.rows[0] as { n: number }
      expect(countRow.n).toBe(1)

      // 5) deletedAt cleared, tokens re-encrypted (different ciphertext),
      //    scope + externalUserId updated.
      const after = await client.query(
        `SELECT access_token, refresh_token, deleted_at, deleted_by,
                scope, external_user_id
         FROM telephony_connections WHERE id = $1`,
        [first.id],
      )
      const row = after.rows[0] as {
        access_token: string
        refresh_token: string
        deleted_at: Date | null
        deleted_by: string | null
        scope: string
        external_user_id: string
      }
      expect(row.deleted_at).toBeNull()
      expect(row.deleted_by).toBeNull()
      expect(row.access_token).not.toBe(firstAccessCipher)
      expect(row.refresh_token).not.toBe(firstRefreshCipher)
      expect(row.scope).toBe(reconnectTokens.scope)
      expect(row.external_user_id).toBe(reconnectTokens.owner_id)
      expect(decrypt(row.access_token)).toBe(reconnectTokens.access_token)
      expect(decrypt(row.refresh_token)).toBe(reconnectTokens.refresh_token)
    })
  })
})

describe("telephony callback — cross-org RLS isolation", () => {
  it("orgA's RLS context returns orgA's id and explicitly NOT orgB's id", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, userId } = await seedTwoOrgsAndUser(client)
      const inFiveMinutes = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      // orgA's connection
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const connAId = createId()
      await client.query(
        `INSERT INTO telephony_connections
           (id, organization_id, user_id, provider, access_token, refresh_token,
            access_token_expires_at, refresh_token_expires_at, scope, external_user_id)
         VALUES ($1, $2, $3, 'ringcentral', $4, $5, $6, $7, 'ReadCallLog SMS', 'rc_ext_orgA')`,
        [connAId, orgA, userId, encrypt("AT_orgA"), encrypt("RT_orgA"), inFiveMinutes, inSevenDays],
      )

      // orgB's connection
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const connBId = createId()
      await client.query(
        `INSERT INTO telephony_connections
           (id, organization_id, user_id, provider, access_token, refresh_token,
            access_token_expires_at, refresh_token_expires_at, scope, external_user_id)
         VALUES ($1, $2, $3, 'ringcentral', $4, $5, $6, $7, 'ReadCallLog SMS', 'rc_ext_orgB')`,
        [connBId, orgB, userId, encrypt("AT_orgB"), encrypt("RT_orgB"), inFiveMinutes, inSevenDays],
      )

      // Probe under orgA's context.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const probe = await client.query(
        "SELECT id FROM telephony_connections WHERE provider = 'ringcentral'",
      )
      const ids = (probe.rows as { id: string }[]).map((r) => r.id)
      expect(ids).toContain(connAId)
      // Explicit assertion: orgB's id must not appear under orgA's context.
      expect(ids).not.toContain(connBId)
      // Defensive: count = 1 (only orgA's row).
      expect(ids.length).toBe(1)
    })
  })
})
