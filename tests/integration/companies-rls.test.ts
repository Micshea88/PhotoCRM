import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

/**
 * RLS negative tests for `companies`. Single org-isolation policy (no
 * role gate). Standard 4-test set: cross-org read 0, no-context read 0,
 * cross-org INSERT rejected, positive control. Raw pg; app layer bypassed.
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

describe("companies — RLS policy", () => {
  it("hides rows from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO companies (id, organization_id, name)
         VALUES ($1, $2, 'Evergreen Planning')`,
        [createId(), orgA],
      )

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM companies")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("returns 0 rows when no org context is set (NULL guard)", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO companies (id, organization_id, name)
         VALUES ($1, $2, 'Evergreen Planning')`,
        [createId(), orgA],
      )

      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM companies")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects an INSERT whose organization_id doesn't match app.current_org", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO companies (id, organization_id, name)
           VALUES ($1, $2, 'Evergreen Planning')`,
          [createId(), orgB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("permits same-org reads (positive control)", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO companies (id, organization_id, name, website, category)
         VALUES ($1, $2, 'Evergreen Planning', 'https://evergreen.example', 'Wedding Planner')`,
        [createId(), orgA],
      )

      const probe = await client.query("SELECT name, website, category FROM companies")
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        name: "Evergreen Planning",
        website: "https://evergreen.example",
        category: "Wedding Planner",
      })
    })
  })
})
