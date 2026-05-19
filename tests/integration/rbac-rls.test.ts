import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

/**
 * RLS for the rbac tables. Two attack surfaces are checked:
 *
 *   1. Org-isolation — same shape as terminology + custom-fields RLS tests.
 *   2. Role-gate — owner/admin can INSERT/UPDATE/DELETE; everyone else
 *      cannot. The role-gate is the high-risk one: an escape would let a
 *      photographer or contractor promote themselves to owner.
 *
 * UPDATE/DELETE failure modes: Postgres permissive-policy semantics mean
 * a denied UPDATE/DELETE silently affects zero rows (no error). We assert
 * `rowCount === 0` rather than `.rejects.toThrow`. INSERTs that violate
 * WITH CHECK *do* throw.
 *
 * Three users in these tests are simulated by setting app.current_role to
 * different values within one transaction. No actual user table rows are
 * needed for the policy to evaluate — the policy reads `current_setting`.
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

describe("rbac — RLS: org isolation", () => {
  it("hides member_role rows across orgs", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, userId } = await seedTwoOrgsAndOneUser(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      await client.query(
        `INSERT INTO member_role (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'admin')`,
        [createId(), orgA, userId],
      )

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM member_role")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("returns 0 rows when no org context is set", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndOneUser(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      await client.query(
        `INSERT INTO member_role (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'admin')`,
        [createId(), orgA, userId],
      )

      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM member_role")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT (WITH CHECK violation)", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB, userId } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")

      await expect(
        client.query(
          `INSERT INTO member_role (id, organization_id, user_id, role)
           VALUES ($1, $2, $3, 'admin')`,
          [createId(), orgB, userId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("permits same-org reads (positive control)", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      await client.query(
        `INSERT INTO member_role (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'admin')`,
        [createId(), orgA, userId],
      )
      const probe = await client.query("SELECT user_id, role FROM member_role WHERE user_id = $1", [
        userId,
      ])
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({ user_id: userId, role: "admin" })
    })
  })
})

describe("rbac — RLS: admin-only write gate on member_role", () => {
  it("rejects INSERT when current_role is not owner/admin", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      // Photographer trying to promote themselves to owner.
      await client.query("SELECT set_config('app.current_role', 'photographer', true)")
      await expect(
        client.query(
          `INSERT INTO member_role (id, organization_id, user_id, role)
           VALUES ($1, $2, $3, 'owner')`,
          [createId(), orgA, userId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("UPDATE by a non-admin affects zero rows", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndOneUser(client)

      // Seed a row as admin
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      await client.query(
        `INSERT INTO member_role (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'photographer')`,
        [createId(), orgA, userId],
      )

      // Switch to the non-admin and try to escalate
      await client.query("SELECT set_config('app.current_role', 'photographer', true)")
      const update = await client.query(
        "UPDATE member_role SET role = 'owner' WHERE user_id = $1",
        [userId],
      )
      expect(update.rowCount).toBe(0)

      // Confirm row is unchanged (read as admin again)
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      const probe = await client.query<{ role: string }>(
        "SELECT role FROM member_role WHERE user_id = $1",
        [userId],
      )
      expect(probe.rows[0]?.role).toBe("photographer")
    })
  })

  it("DELETE by a non-admin affects zero rows", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndOneUser(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      await client.query(
        `INSERT INTO member_role (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'photographer')`,
        [createId(), orgA, userId],
      )

      await client.query("SELECT set_config('app.current_role', 'contractor', true)")
      const del = await client.query("DELETE FROM member_role WHERE user_id = $1", [userId])
      expect(del.rowCount).toBe(0)

      // Row still exists
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      const probe = await client.query("SELECT * FROM member_role WHERE user_id = $1", [userId])
      expect(probe.rows.length).toBe(1)
    })
  })

  it("INSERT succeeds when current_role IS admin (positive control)", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'admin', true)")

      const insert = await client.query(
        `INSERT INTO member_role (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'manager')`,
        [createId(), orgA, userId],
      )
      expect(insert.rowCount).toBe(1)
    })
  })
})

describe("rbac — RLS: admin-only write gate on member_permission_override", () => {
  it("rejects non-admin INSERT", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'photographer', true)")
      await expect(
        client.query(
          `INSERT INTO member_permission_override
             (id, organization_id, user_id, permission_key, granted)
           VALUES ($1, $2, $3, 'view_financial_data', true)`,
          [createId(), orgA, userId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("admin INSERT succeeds (positive control)", async () => {
    await withRawClient(async (client) => {
      const { orgA, userId } = await seedTwoOrgsAndOneUser(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'admin', true)")
      const insert = await client.query(
        `INSERT INTO member_permission_override
           (id, organization_id, user_id, permission_key, granted)
         VALUES ($1, $2, $3, 'view_financial_data', true)`,
        [createId(), orgA, userId],
      )
      expect(insert.rowCount).toBe(1)
    })
  })
})
