/**
 * Integration coverage for the token-refresh helper
 * (src/modules/telephony/token-refresh.ts) — the cases that REQUIRE
 * real Postgres + real transactions.
 *
 * Four cases, three harness shapes:
 *
 *   (a) Parallel callers serialize via SELECT FOR UPDATE — manual
 *       Pool with max:3 (1 seed client + 2 parallel clients), seed
 *       committed before the parallel work begins. Pausable fetch
 *       via Promise-resolve indirection so the test can interleave
 *       the two callers around the FOR UPDATE lock.
 *
 *   (b) refreshConnectionUnconditionally bypasses the 10-min buffer
 *       check — withTestDb harness.
 *
 *   (c)/(d) Auth and transient failures must NOT mutate the row.
 *       The helper's stoic-stance UX contract verified at the
 *       integration boundary: row still selectable, deleted_at
 *       still null. withTestDb harness.
 *
 * No new harness invented — withTestDb mirrors Step 2's
 * telephony-connected-providers.test.ts; the manual Pool mirrors
 * rls-orgaction-write.test.ts.
 *
 * pg_locks polling DELIBERATELY NOT USED — 200ms sleep margin is
 * plenty for local Neon (lock contention on a single test is
 * microseconds), and the test correctness doesn't actually depend
 * on the sleep landing in the lock-held window: if FOR UPDATE works,
 * assertions pass at any margin; if FOR UPDATE doesn't work, BOTH
 * fetches fire regardless of timing → assertion fails.
 */

import { describe, expect, it, vi } from "vitest"

// .env.local has the three RINGCENTRAL_* vars declared with EMPTY values
// (Step 1 placeholder slots — actual RC creds were never wired into local
// dev because OAuth-against-RC has never been run locally). env.ts treats
// empty strings as undefined → performRefresh's RingCentralOAuthNotConfigured
// guard fires before our fetch spy gets a chance. Mock @/lib/env with test
// literals for the RC creds. TELEPHONY_ENCRYPTION_KEY is passed through from
// process.env so crypto.encrypt() round-trips with the real key during seed.
// NODE_ENV is included because pino reads it at module load when log is
// imported by token-refresh.ts. vi.hoisted is required because the factory
// references the envValues closure variable (same pattern as upsertMock in
// tests/unit/token-refresh.test.ts).
//
// Env-mock surface (grep-verified):
//   Module / Field / Reached by / Required?
//   crypto.ts:61 / TELEPHONY_ENCRYPTION_KEY / encrypt+decrypt / YES
//   log.ts:13-14 / NODE_ENV / pino setup at module load / YES
//   token-refresh.ts:203-206 / RINGCENTRAL_CLIENT_ID/SECRET/SERVER_URL / performRefresh / YES (all three)
//   ringcentral-oauth.ts:42 / NEXT_PUBLIC_APP_URL / requireConfig — NOT REACHED by performRefresh
//   actions.ts:91 / NODE_ENV / server-action cookie flag — NOT REACHED
//   upsert.ts — no env reads
const envValues = vi.hoisted(() => ({
  NODE_ENV: process.env.NODE_ENV,
  TELEPHONY_ENCRYPTION_KEY: process.env.TELEPHONY_ENCRYPTION_KEY ?? "",
  RINGCENTRAL_CLIENT_ID: "test-client-id",
  RINGCENTRAL_CLIENT_SECRET: "test-client-secret",
  RINGCENTRAL_SERVER_URL: "https://platform.devtest.ringcentral.com",
}))
vi.mock("@/lib/env", () => ({ env: envValues }))

import { drizzle } from "drizzle-orm/node-postgres"
import { eq } from "drizzle-orm"
import { Pool, type PoolClient } from "pg"
import { createId } from "@paralleldrive/cuid2"
import { setOrgContext, withTestDb } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { encrypt } from "@/lib/crypto"
import * as schema from "@/db/schema"
import { telephonyConnections } from "@/modules/telephony/schema"
import { upsertRingCentralConnection } from "@/modules/telephony/upsert"
import {
  getValidAccessToken,
  refreshConnectionUnconditionally,
  RingCentralAuthError,
  RingCentralTransientError,
} from "@/modules/telephony/token-refresh"

const NEW_TOKEN_BODY = {
  access_token: "FRESH_AT_xyz",
  refresh_token: "FRESH_RT_abc",
  expires_in: 3600,
  refresh_token_expires_in: 604800,
  scope: "ReadCallLog ReadMessages SMS VoipCalling",
  owner_id: "rc_ext_999",
}

function rcResponse(args: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(args.body), {
    status: args.status,
    headers: { "content-type": "application/json" },
  })
}

// ─── (a) Parallel callers → 1 fetch, identical tokens ──────────────

describe("token-refresh integration — parallel callers serialize via FOR UPDATE", () => {
  it("two concurrent getValidAccessToken calls return the same fresh token from exactly one RC fetch", async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests")
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 })

    let userId!: string
    let orgId!: string

    try {
      // ── Seed: user + org + member + telephony_connections (committed) ──
      const seedClient = await pool.connect()
      try {
        await seedClient.query("BEGIN")
        userId = createId()
        orgId = createId()
        await seedClient.query(
          `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
           VALUES ($1, $2, $3, true, NOW(), NOW())`,
          [userId, "Parallel Test User", `${userId.slice(0, 8)}@example.com`],
        )
        await seedClient.query(
          `INSERT INTO organization (id, name, slug, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [orgId, "Parallel Test Org", `parallel-${orgId.slice(0, 8)}`],
        )
        await seedClient.query(
          `INSERT INTO member (id, organization_id, user_id, role, created_at)
           VALUES ($1, $2, $3, 'owner', NOW())`,
          [createId(), orgId, userId],
        )
        // RLS context for the connection insert.
        await seedClient.query("SELECT set_config('app.current_org', $1, true)", [orgId])
        const nearExpiry = new Date(Date.now() + 5 * 60 * 1000) // 5 min — within 10-min buffer
        const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        await seedClient.query(
          `INSERT INTO telephony_connections
             (id, organization_id, user_id, provider, access_token, refresh_token,
              access_token_expires_at, refresh_token_expires_at, scope, external_user_id)
           VALUES ($1, $2, $3, 'ringcentral', $4, $5, $6, $7,
                   'ReadCallLog ReadMessages SMS VoipCalling', 'rc_ext_parallel')`,
          [
            createId(),
            orgId,
            userId,
            encrypt("OLD_AT_seed"),
            encrypt("OLD_RT_seed"),
            nearExpiry.toISOString(),
            refreshExpiry.toISOString(),
          ],
        )
        await seedClient.query("COMMIT")
      } finally {
        seedClient.release()
      }

      // ── Pausable fetch ──
      let resolveFetch!: (r: Response) => void
      let fetchHasBeenCalledNotify!: () => void
      const fetchFirstCallSignal = new Promise<void>((r) => {
        fetchHasBeenCalledNotify = r
      })
      const fetchSpy = vi.fn(() => {
        fetchHasBeenCalledNotify()
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })
      })
      const originalFetch = global.fetch
      global.fetch = fetchSpy

      // ── Two parallel callers ──
      async function runCaller(client: PoolClient): Promise<{ token: string; rotated: boolean }> {
        await client.query("BEGIN")
        await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
        await client.query("SELECT set_config('app.current_role', 'owner', true)")
        await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
        const tx = drizzle(client, { schema })
        try {
          const result = await getValidAccessToken({ organizationId: orgId, userId }, tx)
          await client.query("COMMIT")
          return result
        } catch (e) {
          await client.query("ROLLBACK")
          throw e
        }
      }

      const clientA = await pool.connect()
      const clientB = await pool.connect()
      try {
        const callA = runCaller(clientA)
        await fetchFirstCallSignal // A is inside performRefresh, holding FOR UPDATE lock
        const callB = runCaller(clientB) // B starts, blocks at FOR UPDATE
        await new Promise((r) => setTimeout(r, 200)) // give B a chance to attempt the lock
        resolveFetch(rcResponse({ status: 200, body: NEW_TOKEN_BODY })) // A's fetch resolves → A commits → lock released → B unblocks

        const [resultA, resultB] = await Promise.all([callA, callB])

        // Exactly ONE RC fetch happened — B re-read the fresh row
        // after A's commit and never called fetch.
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        // Both callers got the same fresh token (serialization proof).
        expect(resultA.token).toBe(NEW_TOKEN_BODY.access_token)
        expect(resultB.token).toBe(resultA.token)
        // Stronger proof of the FOR UPDATE optimization: A actually
        // performed the OAuth refresh; B saw A's committed fresh row
        // after the lock released and skipped the fetch entirely.
        expect(resultA.rotated).toBe(true)
        expect(resultB.rotated).toBe(false)
      } finally {
        clientA.release()
        clientB.release()
        global.fetch = originalFetch
      }
    } finally {
      // ── Cleanup: FK-ordered DELETE, per-statement try/catch ──
      const cleanupClient = await pool.connect()
      try {
        try {
          await cleanupClient.query(
            `DELETE FROM telephony_connections WHERE organization_id = $1`,
            [orgId],
          )
        } catch {
          /* ignore */
        }
        try {
          await cleanupClient.query(`DELETE FROM member WHERE organization_id = $1`, [orgId])
        } catch {
          /* ignore */
        }
        try {
          await cleanupClient.query(`DELETE FROM organization WHERE id = $1`, [orgId])
        } catch {
          /* ignore */
        }
        try {
          await cleanupClient.query(`DELETE FROM "user" WHERE id = $1`, [userId])
        } catch {
          /* ignore */
        }
      } finally {
        cleanupClient.release()
      }
      await pool.end()
    }
  })
})

// ─── (b) refreshConnectionUnconditionally bypasses buffer ──────────

describe("token-refresh integration — refreshConnectionUnconditionally bypasses buffer", () => {
  it("with token NOT near expiry (1h remaining), still calls fetch + upserts new tokens", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Seed: token expires in 1 hour — well outside the 10-min buffer.
      await upsertRingCentralConnection(db, {
        organizationId: orgId,
        userId,
        tokens: {
          access_token: "OLD_AT_b",
          refresh_token: "OLD_RT_b",
          expires_in: 3600,
          refresh_token_expires_in: 604800,
          scope: "ReadCallLog SMS",
          owner_id: "rc_ext_b",
        },
      })

      const fetchSpy = vi.fn(() =>
        Promise.resolve(rcResponse({ status: 200, body: NEW_TOKEN_BODY })),
      )
      const originalFetch = global.fetch
      global.fetch = fetchSpy

      try {
        const result = await refreshConnectionUnconditionally(db, {
          organizationId: orgId,
          userId,
        })
        // Bypass proof: fetch was called even though access token isn't near expiry.
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        // Unconditional refresh always rotates by definition.
        expect(result.rotated).toBe(true)
        expect(result.token).toBe(NEW_TOKEN_BODY.access_token)
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})

// ─── (c) Auth failure → row unchanged ──────────────────────────────

describe("token-refresh integration — auth failure does NOT mutate deletedAt", () => {
  it("RC 400 invalid_grant → RingCentralAuthError + row still selectable + deletedAt null", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const { id: connectionId } = await upsertRingCentralConnection(db, {
        organizationId: orgId,
        userId,
        tokens: {
          access_token: "OLD_AT_c",
          refresh_token: "OLD_RT_c",
          expires_in: 300, // 5 min — within buffer, will trigger refresh
          refresh_token_expires_in: 604800,
          scope: "ReadCallLog SMS",
          owner_id: "rc_ext_c",
        },
      })

      const fetchSpy = vi.fn(() =>
        Promise.resolve(
          rcResponse({
            status: 400,
            body: { error: "invalid_grant", error_description: "expired refresh token" },
          }),
        ),
      )
      const originalFetch = global.fetch
      global.fetch = fetchSpy

      try {
        try {
          await getValidAccessToken({ organizationId: orgId, userId }, db)
          throw new Error("expected throw")
        } catch (e) {
          expect(e).toBeInstanceOf(RingCentralAuthError)
          expect((e as RingCentralAuthError).code).toBe("invalid_grant")
        }

        // UX contract: row is still selectable AND deletedAt is null.
        const [row] = await db
          .select()
          .from(telephonyConnections)
          .where(eq(telephonyConnections.id, connectionId))
          .limit(1)
        expect(row).toBeDefined()
        expect(row?.deletedAt).toBeNull()
        // fetch was called once (the failing refresh attempt).
        expect(fetchSpy).toHaveBeenCalledTimes(1)
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})

// ─── (d) Network error → row unchanged ─────────────────────────────

describe("token-refresh integration — network error does NOT mutate deletedAt", () => {
  it("fetch rejects → RingCentralTransientError + row still selectable + deletedAt null", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const { id: connectionId } = await upsertRingCentralConnection(db, {
        organizationId: orgId,
        userId,
        tokens: {
          access_token: "OLD_AT_d",
          refresh_token: "OLD_RT_d",
          expires_in: 300,
          refresh_token_expires_in: 604800,
          scope: "ReadCallLog SMS",
          owner_id: "rc_ext_d",
        },
      })

      const fetchSpy = vi.fn(() => Promise.reject(new Error("network down")))
      const originalFetch = global.fetch
      global.fetch = fetchSpy

      try {
        try {
          await getValidAccessToken({ organizationId: orgId, userId }, db)
          throw new Error("expected throw")
        } catch (e) {
          expect(e).toBeInstanceOf(RingCentralTransientError)
          expect((e as RingCentralTransientError).code).toBe("network_error")
          expect((e as RingCentralTransientError).detail).toContain("network down")
        }

        const [row] = await db
          .select()
          .from(telephonyConnections)
          .where(eq(telephonyConnections.id, connectionId))
          .limit(1)
        expect(row).toBeDefined()
        expect(row?.deletedAt).toBeNull()
        // fetch was invoked once before rejecting.
        expect(fetchSpy).toHaveBeenCalledTimes(1)
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})
