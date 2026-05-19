import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

/**
 * RLS negative tests for `opportunities`. Standard 4-test set: cross-org
 * read, cross-org INSERT rejection, no-context, positive control.
 *
 * Each test needs the full FK chain: organization → pipeline → stage,
 * organization → project. Seed both in the same withRawClient
 * transaction.
 */

async function seedTwoOrgsAndDeps(client: PoolClient) {
  const orgA = createId()
  const orgB = createId()
  const projectA = createId()
  const projectB = createId()
  const pipelineA = createId()
  const pipelineB = createId()
  const stageA = createId()
  const stageB = createId()

  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'Org A', $2, NOW()), ($3, 'Org B', $4, NOW())`,
    [orgA, `orga-${orgA.slice(0, 8)}`, orgB, `orgb-${orgB.slice(0, 8)}`],
  )
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
  await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'PA')`, [
    projectA,
    orgA,
  ])
  await client.query(
    `INSERT INTO pipelines (id, organization_id, name, type) VALUES ($1, $2, 'Sales', 'sales')`,
    [pipelineA, orgA],
  )
  await client.query(
    `INSERT INTO pipeline_stages (id, organization_id, pipeline_id, name, "order")
     VALUES ($1, $2, $3, 'New Inquiry', 0)`,
    [stageA, orgA, pipelineA],
  )
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
  await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'PB')`, [
    projectB,
    orgB,
  ])
  await client.query(
    `INSERT INTO pipelines (id, organization_id, name, type) VALUES ($1, $2, 'Sales', 'sales')`,
    [pipelineB, orgB],
  )
  await client.query(
    `INSERT INTO pipeline_stages (id, organization_id, pipeline_id, name, "order")
     VALUES ($1, $2, $3, 'New Inquiry', 0)`,
    [stageB, orgB, pipelineB],
  )

  return { orgA, orgB, projectA, projectB, pipelineA, pipelineB, stageA, stageB }
}

describe("opportunities — RLS policy", () => {
  it("hides opportunities from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, projectA, pipelineA, stageA } = await seedTwoOrgsAndDeps(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO opportunities (id, organization_id, project_id, pipeline_id, stage_id, value_cents)
         VALUES ($1, $2, $3, $4, $5, 680000)`,
        [createId(), orgA, projectA, pipelineA, stageA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM opportunities")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT (WITH CHECK violation)", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, projectA, pipelineA, stageA } = await seedTwoOrgsAndDeps(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO opportunities (id, organization_id, project_id, pipeline_id, stage_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [createId(), orgB, projectA, pipelineA, stageA],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const { orgA, projectA, pipelineA, stageA } = await seedTwoOrgsAndDeps(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO opportunities (id, organization_id, project_id, pipeline_id, stage_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [createId(), orgA, projectA, pipelineA, stageA],
      )
      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM opportunities")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("positive control: same-org read returns the row with stage info", async () => {
    await withRawClient(async (client) => {
      const { orgA, projectA, pipelineA, stageA } = await seedTwoOrgsAndDeps(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO opportunities
           (id, organization_id, project_id, pipeline_id, stage_id, value_cents, probability_bps, status)
         VALUES ($1, $2, $3, $4, $5, 680000, 5000, 'open')`,
        [createId(), orgA, projectA, pipelineA, stageA],
      )
      const probe = await client.query<{
        value_cents: number
        probability_bps: number
        status: string
      }>("SELECT value_cents, probability_bps, status FROM opportunities")
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        value_cents: 680000,
        probability_bps: 5000,
        status: "open",
      })
    })
  })
})
