/**
 * Standard RLS tests for the three workflow tables. Org-isolation
 * only (no role gate at the RLS layer; the manage_workflows
 * permission is enforced at the action layer via hasPermission).
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

describe("workflows — RLS", () => {
  it("hides workflows from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO workflows (id, organization_id, name, trigger_type)
         VALUES ($1, $2, 'W', 'opportunity.won')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM workflows")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO workflows (id, organization_id, name, trigger_type)
           VALUES ($1, $2, 'X', 'opportunity.won')`,
          [createId(), orgB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const result = await client.query(`SELECT * FROM workflows`)
      expect(result.rows.length).toBe(0)
    })
  })

  it("positive control: same-org reads work", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const wfId = createId()
      await client.query(
        `INSERT INTO workflows (id, organization_id, name, trigger_type)
         VALUES ($1, $2, 'W', 'opportunity.won')`,
        [wfId, orgA],
      )
      const r = await client.query(`SELECT id FROM workflows WHERE id = $1`, [wfId])
      expect(r.rows.length).toBe(1)
    })
  })
})

describe("workflow_steps — RLS", () => {
  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      // Seed a workflow in orgA.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const wfId = createId()
      await client.query(
        `INSERT INTO workflows (id, organization_id, name, trigger_type)
         VALUES ($1, $2, 'W', 'opportunity.won')`,
        [wfId, orgA],
      )
      // Try to insert a step claiming orgB.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      await expect(
        client.query(
          `INSERT INTO workflow_steps (id, organization_id, workflow_id, sequence_no, action_type)
           VALUES ($1, $2, $3, 0, 'send_email')`,
          [createId(), orgA, wfId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })
})

describe("workflow_executions — RLS", () => {
  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const wfId = createId()
      await client.query(
        `INSERT INTO workflows (id, organization_id, name, trigger_type)
         VALUES ($1, $2, 'W', 'opportunity.won')`,
        [wfId, orgA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      await expect(
        client.query(
          `INSERT INTO workflow_executions (id, organization_id, workflow_id, trigger_event_type, trigger_event_id, idempotency_key)
           VALUES ($1, $2, $3, 'opportunity.won', $4, $5)`,
          [createId(), orgA, wfId, createId(), createId()],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })
})
