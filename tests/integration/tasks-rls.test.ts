import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

/**
 * RLS negative tests for the four tasks-module tables. 4 standard tests
 * on `tasks` plus 1 cross-org INSERT rejection on each of the other 3
 * = 7 tests total. Raw pg; app layer bypassed.
 */

async function seedTwoOrgsAndProjects(client: PoolClient) {
  const orgA = createId()
  const orgB = createId()
  const projectA = createId()
  const projectB = createId()
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
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
  await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'PB')`, [
    projectB,
    orgB,
  ])
  return { orgA, orgB, projectA, projectB }
}

describe("tasks — RLS policy", () => {
  it("hides tasks from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, projectA } = await seedTwoOrgsAndProjects(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO tasks (id, organization_id, project_id, title)
         VALUES ($1, $2, $3, 'Task A')`,
        [createId(), orgA, projectA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM tasks")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT into tasks", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, projectA } = await seedTwoOrgsAndProjects(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO tasks (id, organization_id, project_id, title)
           VALUES ($1, $2, $3, 'X')`,
          [createId(), orgB, projectA],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const { orgA, projectA } = await seedTwoOrgsAndProjects(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO tasks (id, organization_id, project_id, title)
         VALUES ($1, $2, $3, 'X')`,
        [createId(), orgA, projectA],
      )
      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM tasks")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("positive control: same-org read returns the row", async () => {
    await withRawClient(async (client) => {
      const { orgA, projectA } = await seedTwoOrgsAndProjects(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO tasks (id, organization_id, project_id, title, status, priority)
         VALUES ($1, $2, $3, 'Send welcome packet', 'not_started', 'high')`,
        [createId(), orgA, projectA],
      )
      const probe = await client.query<{ title: string; status: string; priority: string }>(
        "SELECT title, status, priority FROM tasks",
      )
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        title: "Send welcome packet",
        status: "not_started",
        priority: "high",
      })
    })
  })
})

describe("tasks — sub-tables RLS", () => {
  it("rejects cross-org INSERT into task_dependencies", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, projectA } = await seedTwoOrgsAndProjects(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const taskA = createId()
      const taskB = createId()
      await client.query(
        `INSERT INTO tasks (id, organization_id, project_id, title)
         VALUES ($1, $2, $3, 'A'), ($4, $2, $3, 'B')`,
        [taskA, orgA, projectA, taskB],
      )
      await expect(
        client.query(
          `INSERT INTO task_dependencies (id, organization_id, task_id, blocked_by_task_id)
           VALUES ($1, $2, $3, $4)`,
          [createId(), orgB, taskA, taskB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("rejects cross-org INSERT into task_checklist_items", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, projectA } = await seedTwoOrgsAndProjects(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const taskId = createId()
      await client.query(
        `INSERT INTO tasks (id, organization_id, project_id, title)
         VALUES ($1, $2, $3, 'T')`,
        [taskId, orgA, projectA],
      )
      await expect(
        client.query(
          `INSERT INTO task_checklist_items (id, organization_id, task_id, label)
           VALUES ($1, $2, $3, 'item')`,
          [createId(), orgB, taskId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("rejects cross-org INSERT into project_stages", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, projectA } = await seedTwoOrgsAndProjects(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO project_stages (id, organization_id, project_id, name)
           VALUES ($1, $2, $3, 'Pre-shoot')`,
          [createId(), orgB, projectA],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })
})
