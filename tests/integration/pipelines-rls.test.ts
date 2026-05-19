import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

/**
 * RLS negative tests for `pipelines` and `pipeline_stages`. Standard
 * single-policy org isolation; both tables checked. Raw pg, app layer
 * bypassed.
 */

async function seedTwoOrgs(client: PoolClient) {
  const orgA = createId()
  const orgB = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'Org A', $2, NOW()), ($3, 'Org B', $4, NOW())`,
    [orgA, `orga-${orgA.slice(0, 8)}`, orgB, `orgb-${orgB.slice(0, 8)}`],
  )
  return { orgA, orgB }
}

describe("pipelines — RLS policy", () => {
  it("hides rows from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO pipelines (id, organization_id, name, type)
         VALUES ($1, $2, 'Sales', 'sales')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM pipelines")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO pipelines (id, organization_id, name, type)
           VALUES ($1, $2, 'Sales', 'sales')`,
          [createId(), orgB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO pipelines (id, organization_id, name, type)
         VALUES ($1, $2, 'Sales', 'sales')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM pipelines")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("same-org positive control", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO pipelines (id, organization_id, name, type, display_order)
         VALUES ($1, $2, 'Sales', 'sales', 0)`,
        [createId(), orgA],
      )
      const probe = await client.query<{ name: string; type: string }>(
        "SELECT name, type FROM pipelines",
      )
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({ name: "Sales", type: "sales" })
    })
  })
})

describe("pipeline_stages — RLS policy", () => {
  it("hides rows from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const pipelineId = createId()
      await client.query(
        `INSERT INTO pipelines (id, organization_id, name, type)
         VALUES ($1, $2, 'Sales', 'sales')`,
        [pipelineId, orgA],
      )
      await client.query(
        `INSERT INTO pipeline_stages (id, organization_id, pipeline_id, name, "order")
         VALUES ($1, $2, $3, 'New Inquiry', 0)`,
        [createId(), orgA, pipelineId],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM pipeline_stages")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT into stages", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      // Seed orgA's pipeline as orgA
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const pipelineId = createId()
      await client.query(
        `INSERT INTO pipelines (id, organization_id, name, type)
         VALUES ($1, $2, 'Sales', 'sales')`,
        [pipelineId, orgA],
      )
      // Try to insert a stage with orgB id (pointing at orgA's pipeline).
      // WITH CHECK on pipeline_stages requires organization_id = orgA;
      // we're providing orgB, so it fails.
      await expect(
        client.query(
          `INSERT INTO pipeline_stages (id, organization_id, pipeline_id, name, "order")
           VALUES ($1, $2, $3, 'X', 0)`,
          [createId(), orgB, pipelineId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const pipelineId = createId()
      await client.query(
        `INSERT INTO pipelines (id, organization_id, name, type)
         VALUES ($1, $2, 'Sales', 'sales')`,
        [pipelineId, orgA],
      )
      await client.query(
        `INSERT INTO pipeline_stages (id, organization_id, pipeline_id, name, "order")
         VALUES ($1, $2, $3, 'New Inquiry', 0)`,
        [createId(), orgA, pipelineId],
      )
      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM pipeline_stages")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("same-org positive control with stage ordering", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const pipelineId = createId()
      await client.query(
        `INSERT INTO pipelines (id, organization_id, name, type)
         VALUES ($1, $2, 'Sales', 'sales')`,
        [pipelineId, orgA],
      )
      await client.query(
        `INSERT INTO pipeline_stages (id, organization_id, pipeline_id, name, "order", probability)
         VALUES ($1, $2, $3, 'New Inquiry', 0, 10),
                ($4, $2, $3, 'Booked', 6, 100)`,
        [createId(), orgA, pipelineId, createId()],
      )
      const probe = await client.query<{ name: string; order: number }>(
        `SELECT name, "order" FROM pipeline_stages ORDER BY "order"`,
      )
      expect(probe.rows.length).toBe(2)
      expect(probe.rows[0]?.name).toBe("New Inquiry")
      expect(probe.rows[1]?.name).toBe("Booked")
    })
  })
})
