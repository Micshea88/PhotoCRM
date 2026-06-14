/**
 * Org-isolation RLS tests for rc_sync_jobs (Build 1) — mirrors the standard
 * pattern (ai_assistant_messages-rls). The sync layer writes these rows from
 * machine contexts via set_config('app.current_org', ...); RLS must isolate.
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

async function insertJob(client: PoolClient, orgId: string) {
  await client.query(
    `INSERT INTO rc_sync_jobs (id, organization_id, kind, status)
     VALUES ($1, $2, 'call_log', 'pending')`,
    [createId(), orgId],
  )
}

describe("rc_sync_jobs — RLS", () => {
  it("hides jobs from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await insertJob(client, orgA)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM rc_sync_jobs")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects a cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO rc_sync_jobs (id, organization_id, kind, status)
           VALUES ($1, $2, 'call_log', 'pending')`,
          [createId(), orgB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const result = await client.query("SELECT * FROM rc_sync_jobs")
      expect(result.rows.length).toBe(0)
    })
  })

  it("positive control: same-org reads work", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await insertJob(client, orgA)
      const r = await client.query("SELECT id FROM rc_sync_jobs")
      expect(r.rows.length).toBe(1)
    })
  })
})
