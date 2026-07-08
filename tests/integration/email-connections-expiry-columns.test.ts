/**
 * Integration test for Task 3 — email_connections.expired_at + expired_reason columns.
 *
 * Asserts:
 * 1. A row inserted WITHOUT the new fields has expired_at === null,
 *    expired_reason === null, and status stays its default "connected".
 * 2. A row inserted WITH expired_at + expired_reason reads them back correctly.
 *
 * Uses the raw-pg `withRawClient` helper — tests the database layer directly,
 * no Drizzle, no orgAction.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

interface EmailConnectionRow {
  expired_at: Date | null
  expired_reason: string | null
  status: string
}

async function seedOrg(client: PoolClient): Promise<string> {
  const orgId = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'Test Org', $2, NOW())`,
    [orgId, `test-${orgId.slice(0, 8)}`],
  )
  return orgId
}

async function seedUser(client: PoolClient): Promise<string> {
  const userId = createId()
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Test User', $2, true, NOW(), NOW())`,
    [userId, `user-${userId.slice(0, 8)}@example.com`],
  )
  return userId
}

describe("email_connections — expired_at + expired_reason columns", () => {
  it("defaults: new row without new fields has expired_at=null, expired_reason=null, status='connected'", async () => {
    await withRawClient(async (client) => {
      const orgId = await seedOrg(client)
      const userId = await seedUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])

      const id = createId()
      await client.query(
        `INSERT INTO email_connections
           (id, organization_id, user_id, implementation, provider, source_value, email, grant_id, scopes)
         VALUES ($1, $2, $3, 'nylas', 'google', 'gmail', 'test@example.com', 'grant-abc', 'email.send')`,
        [id, orgId, userId],
      )

      const r = await client.query(
        `SELECT expired_at, expired_reason, status
         FROM email_connections WHERE id = $1`,
        [id],
      )
      expect(r.rows.length).toBe(1)
      const row = r.rows[0] as EmailConnectionRow

      expect(row.expired_at).toBeNull()
      expect(row.expired_reason).toBeNull()
      // status must remain unchanged at its default
      expect(row.status).toBe("connected")
    })
  })

  it("positive: row inserted with expired_at + expired_reason reads them back correctly", async () => {
    await withRawClient(async (client) => {
      const orgId = await seedOrg(client)
      const userId = await seedUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])

      const id = createId()
      const expiredAt = new Date("2026-07-04T12:00:00Z")
      await client.query(
        `INSERT INTO email_connections
           (id, organization_id, user_id, implementation, provider, source_value, email, grant_id, scopes,
            expired_at, expired_reason)
         VALUES ($1, $2, $3, 'nylas', 'google', 'gmail', 'test2@example.com', 'grant-def', 'email.send',
                 $4, $5)`,
        [id, orgId, userId, expiredAt, "Token revoked by user in Google account settings"],
      )

      const r = await client.query(
        `SELECT expired_at, expired_reason, status
         FROM email_connections WHERE id = $1`,
        [id],
      )
      expect(r.rows.length).toBe(1)
      const row = r.rows[0] as EmailConnectionRow

      expect(row.expired_at).not.toBeNull()
      expect(new Date(row.expired_at!).toISOString()).toBe(expiredAt.toISOString())
      expect(row.expired_reason).toBe("Token revoked by user in Google account settings")
      // status column must NOT be touched by this task
      expect(row.status).toBe("connected")
    })
  })
})
