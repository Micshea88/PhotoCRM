import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

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

describe("saved_views — RLS policy", () => {
  it("hides views from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name)
         VALUES ($1, $2, 'contact', 'My Vendors')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM saved_views")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO saved_views (id, organization_id, object_type, name)
           VALUES ($1, $2, 'contact', 'X')`,
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
        `INSERT INTO saved_views (id, organization_id, object_type, name)
         VALUES ($1, $2, 'contact', 'X')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM saved_views")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("positive control: same-org read returns the row with jsonb filter shape", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name, filters, shared)
         VALUES ($1, $2, 'contact', 'Vendor Matrix',
                 $3::jsonb, true)`,
        [createId(), orgA, JSON.stringify([{ field: "contactType", op: "eq", value: "Vendor" }])],
      )
      const probe = await client.query<{
        name: string
        object_type: string
        filters: unknown
        shared: boolean
      }>("SELECT name, object_type, filters, shared FROM saved_views")
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        name: "Vendor Matrix",
        object_type: "contact",
        shared: true,
      })
      expect(probe.rows[0]?.filters).toEqual([{ field: "contactType", op: "eq", value: "Vendor" }])
    })
  })
})
