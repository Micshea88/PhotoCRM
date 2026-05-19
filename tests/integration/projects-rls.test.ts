import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

/**
 * RLS negative tests for projects + the three association/sub-event
 * tables. 4 tests for `projects` (full standard set) plus one
 * representative cross-org INSERT test per sub-table = 7 total. Same
 * shape as the other RLS suites; raw pg, app layer bypassed.
 */

async function seedTwoOrgsAndOneUser(client: PoolClient) {
  const orgA = createId()
  const orgB = createId()
  const userId = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'Org A', $2, NOW()), ($3, 'Org B', $4, NOW())`,
    [orgA, `orga-${orgA.slice(0, 8)}`, orgB, `orgb-${orgB.slice(0, 8)}`],
  )
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Alice', $2, true, NOW(), NOW())`,
    [userId, `${userId.slice(0, 8)}@example.com`],
  )
  return { orgA, orgB, userId }
}

describe("projects — RLS policy", () => {
  it("hides projects from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO projects (id, organization_id, name, project_type)
         VALUES ($1, $2, 'Smith Wedding', 'Wedding')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM projects")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT into projects", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO projects (id, organization_id, name)
           VALUES ($1, $2, 'X')`,
          [createId(), orgB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO projects (id, organization_id, name)
         VALUES ($1, $2, 'Smith Wedding')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM projects")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("positive control: same-org reads return the row", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO projects (id, organization_id, name, package_base_price_cents)
         VALUES ($1, $2, 'Smith Wedding', 680000)`,
        [createId(), orgA],
      )
      const probe = await client.query<{ name: string; package_base_price_cents: number }>(
        "SELECT name, package_base_price_cents FROM projects",
      )
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        name: "Smith Wedding",
        package_base_price_cents: 680000,
      })
    })
  })
})

describe("project_contacts / project_photographers / project_sub_events — RLS", () => {
  it("rejects cross-org INSERT into project_contacts", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgsAndOneUser(client)
      // Set up: project + contact in orgA
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const projectId = createId()
      const contactId = createId()
      await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'P')`, [
        projectId,
        orgA,
      ])
      await client.query(
        `INSERT INTO contacts (id, organization_id, first_name, last_name)
         VALUES ($1, $2, 'Kelly', 'Smith')`,
        [contactId, orgA],
      )
      // Try to insert a project_contacts row with orgB id — WITH CHECK denies.
      await expect(
        client.query(
          `INSERT INTO project_contacts (id, organization_id, project_id, contact_id, role)
           VALUES ($1, $2, $3, $4, 'primary')`,
          [createId(), orgB, projectId, contactId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("rejects cross-org INSERT into project_photographers", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, userId } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const projectId = createId()
      await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'P')`, [
        projectId,
        orgA,
      ])
      await expect(
        client.query(
          `INSERT INTO project_photographers (id, organization_id, project_id, user_id, role)
           VALUES ($1, $2, $3, $4, 'lead')`,
          [createId(), orgB, projectId, userId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("rejects cross-org INSERT into project_sub_events", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const projectId = createId()
      await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'P')`, [
        projectId,
        orgA,
      ])
      await expect(
        client.query(
          `INSERT INTO project_sub_events (id, organization_id, project_id, event_type)
           VALUES ($1, $2, $3, 'engagement')`,
          [createId(), orgB, projectId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })
})
