import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

/**
 * RLS negative tests for `contacts`. Single org-isolation policy in V1.
 * Standard 4-test set, raw pg, app layer bypassed. See terminology /
 * companies / custom-fields RLS suites for the pattern.
 *
 * The assignment-scoped policy (photographer/contractor/editor sees only
 * their assigned contacts) is deferred until `project_photographers`
 * exists — at which point a second policy and a separate test suite
 * land in the projects module's migration.
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

describe("contacts — RLS policy", () => {
  it("hides rows from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO contacts (id, organization_id, first_name, last_name)
         VALUES ($1, $2, 'Kelly', 'Smith')`,
        [createId(), orgA],
      )

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM contacts")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("returns 0 rows when no org context is set (NULL guard)", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO contacts (id, organization_id, first_name, last_name)
         VALUES ($1, $2, 'Kelly', 'Smith')`,
        [createId(), orgA],
      )

      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM contacts")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects an INSERT whose organization_id doesn't match app.current_org", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO contacts (id, organization_id, first_name, last_name)
           VALUES ($1, $2, 'Kelly', 'Smith')`,
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
        `INSERT INTO contacts (id, organization_id, first_name, last_name, primary_email, contact_type, tags)
         VALUES ($1, $2, 'Kelly', 'Smith', 'kelly@example.com', 'Vendor', ARRAY['vip','planner'])`,
        [createId(), orgA],
      )

      const probe = await client.query<{
        first_name: string
        last_name: string
        primary_email: string
        contact_type: string
        tags: string[]
      }>("SELECT first_name, last_name, primary_email, contact_type, tags FROM contacts")
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        first_name: "Kelly",
        last_name: "Smith",
        primary_email: "kelly@example.com",
        contact_type: "Vendor",
      })
      expect(probe.rows[0]?.tags).toEqual(["vip", "planner"])
    })
  })
})
