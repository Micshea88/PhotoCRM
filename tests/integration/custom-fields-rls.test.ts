import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

/**
 * RLS negative tests for `custom_field_definitions`. Mirrors the
 * terminology-rls pattern exactly: raw pg, app layer bypassed, single
 * transaction that flips `app.current_org` between writes and reads.
 * See tests/integration/terminology-rls.test.ts for the rationale.
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

describe("custom_field_definitions — RLS policy", () => {
  it("hides rows from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO custom_field_definitions
           (id, organization_id, record_type, name, field_type)
         VALUES ($1, $2, 'contact', 'Allergies', 'text')`,
        [createId(), orgA],
      )

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM custom_field_definitions")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("returns 0 rows when no org context is set (NULL guard)", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO custom_field_definitions
           (id, organization_id, record_type, name, field_type)
         VALUES ($1, $2, 'contact', 'Allergies', 'text')`,
        [createId(), orgA],
      )

      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM custom_field_definitions")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects an INSERT whose organization_id doesn't match app.current_org", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO custom_field_definitions
             (id, organization_id, record_type, name, field_type)
           VALUES ($1, $2, 'contact', 'Allergies', 'text')`,
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
        `INSERT INTO custom_field_definitions
           (id, organization_id, record_type, name, field_type, required)
         VALUES ($1, $2, 'contact', 'Allergies', 'text', true)`,
        [createId(), orgA],
      )

      const probe = await client.query(
        "SELECT record_type, name, field_type, required FROM custom_field_definitions",
      )
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        record_type: "contact",
        name: "Allergies",
        field_type: "text",
        required: true,
      })
    })
  })
})
