/**
 * The partial-unique index call_log (org_id, rc_call_id) WHERE rc_call_id IS
 * NOT NULL is the dedup key that lets webhook + targeted-pull + sweep all
 * ON CONFLICT upsert without creating duplicate rows for the same RC call.
 * This proves the constraint enforces uniqueness AND that NULL rc_call_id rows
 * (Pathway-witnessed before a sync links them) don't collide.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

async function seedOrg(client: PoolClient): Promise<string> {
  const orgId = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, 'A', $2, NOW())`,
    [orgId, `a-${orgId.slice(0, 8)}`],
  )
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
  return orgId
}

async function insertCall(client: PoolClient, orgId: string, rcCallId: string | null) {
  await client.query(
    `INSERT INTO call_log (id, organization_id, direction, started_at, source, rc_call_id)
     VALUES ($1, $2, 'incoming', NOW(), 'rc_sync', $3)`,
    [createId(), orgId, rcCallId],
  )
}

describe("call_log (org_id, rc_call_id) partial unique", () => {
  it("rejects a duplicate rc_call_id within an org", async () => {
    await withRawClient(async (client) => {
      const orgId = await seedOrg(client)
      await insertCall(client, orgId, "rc-dup-1")
      await expect(insertCall(client, orgId, "rc-dup-1")).rejects.toThrow(/duplicate key|unique/i)
    })
  })

  it("allows multiple rows with NULL rc_call_id (witnessed-but-unlinked)", async () => {
    await withRawClient(async (client) => {
      const orgId = await seedOrg(client)
      await insertCall(client, orgId, null)
      await insertCall(client, orgId, null)
      const r = await client.query("SELECT id FROM call_log WHERE rc_call_id IS NULL")
      expect(r.rows.length).toBe(2)
    })
  })
})
