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

async function makeUser(client: PoolClient, name = "User") {
  const id = createId()
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), NOW())`,
    [id, name, `${id.slice(0, 8)}@example.com`],
  )
  return id
}

async function setCtx(client: PoolClient, orgId: string, userId: string) {
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
  await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
}

describe("saved_views — RLS policy (3-tier visibility, Push 2b)", () => {
  it("hides views from a probe in a different org", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      const userA = await makeUser(client, "A")
      const userB = await makeUser(client, "B")
      await setCtx(client, orgA, userA)
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name, owner_user_id, visibility)
         VALUES ($1, $2, 'contact', 'My Vendors', $3, 'private')`,
        [createId(), orgA, userA],
      )
      await setCtx(client, orgB, userB)
      const probe = await client.query("SELECT * FROM saved_views")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      const userA = await makeUser(client, "A")
      await setCtx(client, orgA, userA)
      await expect(
        client.query(
          `INSERT INTO saved_views (id, organization_id, object_type, name, owner_user_id, visibility)
           VALUES ($1, $2, 'contact', 'X', $3, 'private')`,
          [createId(), orgB, userA],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      const userA = await makeUser(client, "A")
      await setCtx(client, orgA, userA)
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name, owner_user_id, visibility)
         VALUES ($1, $2, 'contact', 'X', $3, 'private')`,
        [createId(), orgA, userA],
      )
      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM saved_views")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("hides private views from a non-owner in the same org", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      const userA = await makeUser(client, "A")
      const userB = await makeUser(client, "B")
      await setCtx(client, orgA, userA)
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name, owner_user_id, visibility)
         VALUES ($1, $2, 'contact', 'A private', $3, 'private')`,
        [createId(), orgA, userA],
      )
      await setCtx(client, orgA, userB)
      const probe = await client.query("SELECT name FROM saved_views WHERE name = 'A private'")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("shows org-visible views to every member of the org", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      const userA = await makeUser(client, "A")
      const userB = await makeUser(client, "B")
      await setCtx(client, orgA, userA)
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name, owner_user_id, visibility)
         VALUES ($1, $2, 'contact', 'A org', $3, 'org')`,
        [createId(), orgA, userA],
      )
      await setCtx(client, orgA, userB)
      const probe = await client.query("SELECT name FROM saved_views WHERE name = 'A org'")
      expect(probe.rows.length).toBe(1)
    })
  })

  it("shared_users — visible to a user in the shared list, hidden to one not in the list", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      const userA = await makeUser(client, "A")
      const userB = await makeUser(client, "B")
      const userC = await makeUser(client, "C")
      await setCtx(client, orgA, userA)
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name, owner_user_id, visibility, shared_with_user_ids)
         VALUES ($1, $2, 'contact', 'A shared B', $3, 'shared_users', ARRAY[$4]::text[])`,
        [createId(), orgA, userA, userB],
      )
      await setCtx(client, orgA, userB)
      const probeB = await client.query("SELECT name FROM saved_views WHERE name = 'A shared B'")
      expect(probeB.rows.length).toBe(1)

      await setCtx(client, orgA, userC)
      const probeC = await client.query("SELECT name FROM saved_views WHERE name = 'A shared B'")
      expect(probeC.rows.length).toBe(0)
    })
  })

  it("UPDATE/DELETE rejects non-owner mutations even within the org", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      const userA = await makeUser(client, "A")
      const userB = await makeUser(client, "B")
      await setCtx(client, orgA, userA)
      const viewId = createId()
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name, owner_user_id, visibility)
         VALUES ($1, $2, 'contact', 'A org view', $3, 'org')`,
        [viewId, orgA, userA],
      )
      // userB can SEE it (visibility=org), but cannot mutate.
      await setCtx(client, orgA, userB)
      const updateRes = await client.query(
        `UPDATE saved_views SET name = 'hijacked' WHERE id = $1`,
        [viewId],
      )
      // RLS treats forbidden updates as zero-row affected, not an error.
      expect(updateRes.rowCount).toBe(0)
      const deleteRes = await client.query(`DELETE FROM saved_views WHERE id = $1`, [viewId])
      expect(deleteRes.rowCount).toBe(0)
    })
  })

  it("INSERT allows null-owner system defaults regardless of current_user_id", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      // No user-id set — the seed runs in this kind of context from
      // seedNewOrganization (BA hook).
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_user_id', '', true)")
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name, owner_user_id, visibility, is_default)
         VALUES ($1, $2, 'contact', 'All Contacts', NULL, 'org', true)`,
        [createId(), orgA],
      )
      const probe = await client.query("SELECT name FROM saved_views WHERE name = 'All Contacts'")
      expect(probe.rows.length).toBe(1)
    })
  })

  it("positive control: same-org read returns the row with jsonb filter shape", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      const userA = await makeUser(client, "A")
      await setCtx(client, orgA, userA)
      await client.query(
        `INSERT INTO saved_views (id, organization_id, object_type, name, filters, visibility, owner_user_id)
         VALUES ($1, $2, 'contact', 'Vendor Matrix',
                 $3::jsonb, 'org', $4)`,
        [
          createId(),
          orgA,
          JSON.stringify([{ field: "contactType", op: "eq", value: "Vendor" }]),
          userA,
        ],
      )
      const probe = await client.query<{
        name: string
        object_type: string
        filters: unknown
        visibility: string
      }>("SELECT name, object_type, filters, visibility FROM saved_views")
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        name: "Vendor Matrix",
        object_type: "contact",
        visibility: "org",
      })
      expect(probe.rows[0]?.filters).toEqual([{ field: "contactType", op: "eq", value: "Vendor" }])
    })
  })
})
