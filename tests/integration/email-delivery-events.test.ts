/**
 * RLS tests for `email_delivery_events` (Task 1 — append-only delivery
 * event log). Mirrors the pattern of email_log_rls.test.ts: single
 * FOR-ALL policy checking organization_id against the `app.current_org`
 * GUC, plus FORCE ROW LEVEL SECURITY so the table owner can't bypass it.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

async function seedTwoOrgs(client: PoolClient) {
  const orgA = createId()
  const orgB = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'A', $2, NOW()), ($3, 'B', $4, NOW())`,
    [orgA, `a-${orgA.slice(0, 8)}`, orgB, `b-${orgB.slice(0, 8)}`],
  )
  return { orgA, orgB }
}

/** Seeds an email_log row for the given org (required FK for email_delivery_events). */
async function seedEmailLog(client: PoolClient, orgId: string): Promise<string> {
  const id = createId()
  await client.query(
    `INSERT INTO email_log (id, organization_id, direction, sent_at, source)
     VALUES ($1, $2, 'outbound', NOW(), 'manual')`,
    [id, orgId],
  )
  return id
}

describe("email_delivery_events — RLS", () => {
  it("hides delivery events from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      // Insert under org A context.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const emailLogId = await seedEmailLog(client, orgA)
      await client.query(
        `INSERT INTO email_delivery_events
           (id, organization_id, email_log_id, path, type, occurred_at)
         VALUES ($1, $2, $3, 'resend', 'sent', NOW())`,
        [createId(), orgA, emailLogId],
      )

      // Probe under org B — must see zero rows.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM email_delivery_events")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      // Seed a log row under orgA so the FK is valid.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const emailLogId = await seedEmailLog(client, orgA)

      // Attempt to INSERT a row belonging to orgB while context is orgA.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO email_delivery_events
             (id, organization_id, email_log_id, path, type, occurred_at)
           VALUES ($1, $2, $3, 'resend', 'sent', NOW())`,
          [createId(), orgB, emailLogId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const result = await client.query(`SELECT * FROM email_delivery_events`)
      expect(result.rows.length).toBe(0)
    })
  })

  it("positive control: same-org reads work", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const emailLogId = await seedEmailLog(client, orgA)
      const eventId = createId()
      await client.query(
        `INSERT INTO email_delivery_events
           (id, organization_id, email_log_id, path, type, occurred_at)
         VALUES ($1, $2, $3, 'nylas', 'delivered', NOW())`,
        [eventId, orgA, emailLogId],
      )

      const r = await client.query(`SELECT id FROM email_delivery_events WHERE id = $1`, [eventId])
      expect(r.rows.length).toBe(1)
    })
  })

  it("partial unique index prevents duplicate provider_event_id within an org", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const emailLogId = await seedEmailLog(client, orgA)
      const providerEventId = `svix-${createId()}`

      // First insert — must succeed.
      await client.query(
        `INSERT INTO email_delivery_events
           (id, organization_id, email_log_id, path, type, provider_event_id, occurred_at)
         VALUES ($1, $2, $3, 'resend', 'sent', $4, NOW())`,
        [createId(), orgA, emailLogId, providerEventId],
      )

      // Duplicate provider_event_id in same org — must be rejected.
      await expect(
        client.query(
          `INSERT INTO email_delivery_events
             (id, organization_id, email_log_id, path, type, provider_event_id, occurred_at)
           VALUES ($1, $2, $3, 'resend', 'sent', $4, NOW())`,
          [createId(), orgA, emailLogId, providerEventId],
        ),
      ).rejects.toThrow(/unique/i)
    })
  })
})
