/**
 * Standard RLS tests for `email_log` (the first-class table introduced
 * in migration 0040, replacing the Push 3 hack where "Log email" landed
 * as a contact_note with a "Subject: …" prefix).
 *
 * Mirrors the canonical org-isolation surface used by every drift-zone
 * sibling (call_log, meetings, sms_messages) — single FOR-ALL policy
 * checking organization_id against the `app.current_org` GUC.
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

describe("email_log — RLS", () => {
  it("hides emails from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO email_log (id, organization_id, direction, sent_at, source)
         VALUES ($1, $2, 'outbound', NOW(), 'manual')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM email_log")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO email_log (id, organization_id, direction, sent_at, source)
           VALUES ($1, $2, 'outbound', NOW(), 'manual')`,
          [createId(), orgB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const result = await client.query(`SELECT * FROM email_log`)
      expect(result.rows.length).toBe(0)
    })
  })

  it("positive control: same-org reads work", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const id = createId()
      await client.query(
        `INSERT INTO email_log (id, organization_id, direction, sent_at, source)
         VALUES ($1, $2, 'outbound', NOW(), 'manual')`,
        [id, orgA],
      )
      const r = await client.query(`SELECT id FROM email_log WHERE id = $1`, [id])
      expect(r.rows.length).toBe(1)
    })
  })
})
