/**
 * Standard org-isolation RLS tests for ai_assistant_messages.
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

describe("ai_assistant_messages — RLS", () => {
  it("hides messages from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO ai_assistant_messages (id, organization_id, conversation_id, role, content)
         VALUES ($1, $2, 'conv1', 'user', 'hello')`,
        [createId(), orgA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM ai_assistant_messages")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await expect(
        client.query(
          `INSERT INTO ai_assistant_messages (id, organization_id, conversation_id, role, content)
           VALUES ($1, $2, 'x', 'user', 'x')`,
          [createId(), orgB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const result = await client.query(`SELECT * FROM ai_assistant_messages`)
      expect(result.rows.length).toBe(0)
    })
  })

  it("positive control: same-org reads work", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const id = createId()
      await client.query(
        `INSERT INTO ai_assistant_messages (id, organization_id, conversation_id, role, content)
         VALUES ($1, $2, 'conv1', 'user', 'hi')`,
        [id, orgA],
      )
      const r = await client.query(`SELECT id FROM ai_assistant_messages WHERE id = $1`, [id])
      expect(r.rows.length).toBe(1)
    })
  })
})
