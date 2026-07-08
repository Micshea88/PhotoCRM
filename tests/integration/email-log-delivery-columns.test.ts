/**
 * Integration test for Task 2 — email_log denormalized delivery-status +
 * classified-open columns.
 *
 * Asserts:
 * 1. A row inserted WITHOUT the new fields gets correct defaults:
 *    delivery_status = "sent", open_human/bot/unknown_count = 0,
 *    bounced_at/bounce_reason/failed_at = null.
 * 2. A row inserted WITH bounced values reads them back correctly.
 *
 * Uses the raw-pg `withRawClient` helper (same pattern as
 * email-delivery-events.test.ts) — tests the database layer directly, no
 * Drizzle, no orgAction.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

interface EmailLogRow {
  delivery_status: string
  bounced_at: Date | null
  bounce_reason: string | null
  failed_at: Date | null
  open_human_count: number
  open_bot_count: number
  open_unknown_count: number
  open_count: number
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

describe("email_log — delivery-status + classified-open columns", () => {
  it("defaults: new row without new fields has delivery_status='sent' and zero open counts", async () => {
    await withRawClient(async (client) => {
      const orgId = await seedOrg(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])

      const id = createId()
      await client.query(
        `INSERT INTO email_log (id, organization_id, direction, sent_at, source)
         VALUES ($1, $2, 'outbound', NOW(), 'manual')`,
        [id, orgId],
      )

      const r = await client.query(
        `SELECT delivery_status,
                bounced_at,
                bounce_reason,
                failed_at,
                open_human_count,
                open_bot_count,
                open_unknown_count,
                open_count
         FROM email_log WHERE id = $1`,
        [id],
      )
      expect(r.rows.length).toBe(1)
      const row = r.rows[0] as EmailLogRow

      expect(row.delivery_status).toBe("sent")
      expect(row.bounced_at).toBeNull()
      expect(row.bounce_reason).toBeNull()
      expect(row.failed_at).toBeNull()
      expect(row.open_human_count).toBe(0)
      expect(row.open_bot_count).toBe(0)
      expect(row.open_unknown_count).toBe(0)
      // Existing column must remain unchanged.
      expect(row.open_count).toBe(0)
    })
  })

  it("positive: bounced row stores delivery_status, bounced_at, and bounce_reason correctly", async () => {
    await withRawClient(async (client) => {
      const orgId = await seedOrg(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])

      const id = createId()
      const bouncedAt = new Date("2026-07-04T10:00:00Z")
      await client.query(
        `INSERT INTO email_log
           (id, organization_id, direction, sent_at, source,
            delivery_status, bounced_at, bounce_reason)
         VALUES ($1, $2, 'outbound', NOW(), 'manual', $3, $4, $5)`,
        [id, orgId, "bounced", bouncedAt, "5.1.1 User unknown"],
      )

      const r = await client.query(
        `SELECT delivery_status, bounced_at, bounce_reason, failed_at,
                open_human_count, open_bot_count, open_unknown_count
         FROM email_log WHERE id = $1`,
        [id],
      )
      expect(r.rows.length).toBe(1)
      const row = r.rows[0] as EmailLogRow

      expect(row.delivery_status).toBe("bounced")
      expect(row.bounced_at).not.toBeNull()
      expect(new Date(row.bounced_at!).toISOString()).toBe(bouncedAt.toISOString())
      expect(row.bounce_reason).toBe("5.1.1 User unknown")
      expect(row.failed_at).toBeNull()
      expect(row.open_human_count).toBe(0)
      expect(row.open_bot_count).toBe(0)
      expect(row.open_unknown_count).toBe(0)
    })
  })
})
