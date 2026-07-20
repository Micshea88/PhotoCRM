/**
 * Org-isolation RLS tests for background_jobs — mirrors rc-sync-jobs-rls. The
 * queue is written from machine contexts via set_config('app.current_org', …);
 * FORCE RLS must isolate every org's jobs even though the base connection is a
 * BYPASSRLS owner in prod (the switch to app_authenticated in the helper is
 * what makes this genuine — see tests/helpers/rls.ts).
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
    `INSERT INTO background_jobs (id, organization_id, type, status)
     VALUES ($1, $2, 'test_effect', 'pending')`,
    [createId(), orgId],
  )
}

describe("background_jobs — RLS", () => {
  it("hides jobs from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await insertJob(client, orgA)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM background_jobs")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects a cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO background_jobs (id, organization_id, type, status)
           VALUES ($1, $2, 'test_effect', 'pending')`,
          [createId(), orgB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const result = await client.query("SELECT * FROM background_jobs")
      expect(result.rows.length).toBe(0)
    })
  })

  it("positive control: same-org reads work", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await insertJob(client, orgA)
      const r = await client.query("SELECT id FROM background_jobs")
      expect(r.rows.length).toBe(1)
    })
  })
})
