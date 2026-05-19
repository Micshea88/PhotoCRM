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

describe("project_templates — RLS policy", () => {
  it("hides templates from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO project_templates (id, organization_id, name, project_type)
         VALUES ($1, $2, 'Wedding default', 'Wedding')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM project_templates")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO project_templates (id, organization_id, name, project_type)
           VALUES ($1, $2, 'X', 'Wedding')`,
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
        `INSERT INTO project_templates (id, organization_id, name, project_type)
         VALUES ($1, $2, 'X', 'Wedding')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM project_templates")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("positive control: same-org read returns the row", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO project_templates (id, organization_id, name, project_type, default_workflow_ids)
         VALUES ($1, $2, 'Wedding default', 'Wedding', ARRAY['wf1','wf2'])`,
        [createId(), orgA],
      )
      const probe = await client.query<{
        name: string
        project_type: string
        default_workflow_ids: string[]
      }>("SELECT name, project_type, default_workflow_ids FROM project_templates")
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        name: "Wedding default",
        project_type: "Wedding",
      })
      expect(probe.rows[0]?.default_workflow_ids).toEqual(["wf1", "wf2"])
    })
  })
})

describe("project_template_task_items — RLS policy", () => {
  it("rejects cross-org INSERT into task items", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const templateId = createId()
      await client.query(
        `INSERT INTO project_templates (id, organization_id, name, project_type)
         VALUES ($1, $2, 'T', 'Wedding')`,
        [templateId, orgA],
      )
      await expect(
        client.query(
          `INSERT INTO project_template_task_items
             (id, organization_id, project_template_id, stage_name, title, relative_offset_days)
           VALUES ($1, $2, $3, 'Pre-shoot', 'Send packet', -7)`,
          [createId(), orgB, templateId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })
})
