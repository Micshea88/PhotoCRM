/**
 * RLS tests for payment_installments — the financial-table role gate
 * (Tech Arch §4 line 104). V1 gate: owner / admin / accountant.
 * Manager (without grant) and the standard team-member tier (`user`)
 * are blocked. Manager-with-grant is deferred to the Phase 4 admin UI
 * per `rbac/README.md`.
 *
 * Raw-pg, app layer fully bypassed. Same shape as every other RLS suite.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

async function seedOrgAndProject(client: PoolClient) {
  const orgId = createId()
  const userId = createId()
  const projectId = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'Org', $2, NOW())`,
    [orgId, `org-${orgId.slice(0, 8)}`],
  )
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'U', $2, true, NOW(), NOW())`,
    [userId, `${userId.slice(0, 8)}@example.com`],
  )
  await client.query(
    `INSERT INTO member (id, organization_id, user_id, role, created_at)
     VALUES ($1, $2, $3, 'owner', NOW())`,
    [createId(), orgId, userId],
  )
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
  await client.query("SELECT set_config('app.current_role', 'owner', true)")
  await client.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'P')`, [
    projectId,
    orgId,
  ])
  // Seed one installment as owner.
  const installmentId = createId()
  await client.query(
    `INSERT INTO payment_installments (id, organization_id, project_id, sequence_no, split_method, amount_cents)
     VALUES ($1, $2, $3, 1, 'pay_in_full', 50000)`,
    [installmentId, orgId, projectId],
  )
  return { orgId, userId, projectId, installmentId }
}

describe("payment_installments — RLS standard (org isolation)", () => {
  it("hides rows from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const a = await seedOrgAndProject(client)
      const orgB = createId()
      await client.query(
        `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, 'B', $2, NOW())`,
        [orgB, `orgb-${orgB.slice(0, 8)}`],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      // Set role to owner so the financial gate doesn't dominate; we're testing org isolation.
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      const r = await client.query(`SELECT id FROM payment_installments WHERE id = $1`, [
        a.installmentId,
      ])
      expect(r.rows.length).toBe(0)
    })
  })

  it("rejects cross-org INSERT (WITH CHECK violation)", async () => {
    await withRawClient(async (client) => {
      const a = await seedOrgAndProject(client)
      const orgB = createId()
      await client.query(
        `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, 'B', $2, NOW())`,
        [orgB, `orgb-${orgB.slice(0, 8)}`],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      await expect(
        client.query(
          `INSERT INTO payment_installments (id, organization_id, project_id, sequence_no, split_method, amount_cents)
           VALUES ($1, $2, $3, 1, 'pay_in_full', 100)`,
          [createId(), a.orgId, a.projectId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("positive control: same-org owner reads the row", async () => {
    await withRawClient(async (client) => {
      const a = await seedOrgAndProject(client)
      const r = await client.query(`SELECT id FROM payment_installments WHERE id = $1`, [
        a.installmentId,
      ])
      expect(r.rows.length).toBe(1)
    })
  })
})

describe("payment_installments — financial RLS role gate (Tech Arch §4)", () => {
  it("user (standard team-member tier) sees 0 rows (blocked)", async () => {
    // Consolidates the prior photographer/contractor/editor cases — all
    // three old roles collapsed into the single `user` tier per the
    // P4-roles rename (migration 0021). The financial gate uses a
    // positive-match allowlist (owner/admin/accountant), so the rename
    // doesn't change the policy text; it does change what role label
    // the test sets.
    await withRawClient(async (client) => {
      const a = await seedOrgAndProject(client)
      await client.query("SELECT set_config('app.current_role', 'user', true)")
      const r = await client.query(`SELECT id FROM payment_installments WHERE id = $1`, [
        a.installmentId,
      ])
      expect(r.rows.length).toBe(0)
    })
  })

  it("manager (no grant) sees 0 rows — V1 default-blocked; grant flow deferred to Phase 4", async () => {
    await withRawClient(async (client) => {
      const a = await seedOrgAndProject(client)
      await client.query("SELECT set_config('app.current_role', 'manager', true)")
      const r = await client.query(`SELECT id FROM payment_installments WHERE id = $1`, [
        a.installmentId,
      ])
      expect(r.rows.length).toBe(0)
    })
  })

  it("accountant CAN read (financial-permitted role)", async () => {
    await withRawClient(async (client) => {
      const a = await seedOrgAndProject(client)
      await client.query("SELECT set_config('app.current_role', 'accountant', true)")
      const r = await client.query(`SELECT id FROM payment_installments WHERE id = $1`, [
        a.installmentId,
      ])
      expect(r.rows.length).toBe(1)
    })
  })

  it("admin CAN read (financial-permitted role)", async () => {
    await withRawClient(async (client) => {
      const a = await seedOrgAndProject(client)
      await client.query("SELECT set_config('app.current_role', 'admin', true)")
      const r = await client.query(`SELECT id FROM payment_installments WHERE id = $1`, [
        a.installmentId,
      ])
      expect(r.rows.length).toBe(1)
    })
  })

  it("user CANNOT INSERT (financial role gate WITH CHECK)", async () => {
    await withRawClient(async (client) => {
      const a = await seedOrgAndProject(client)
      await client.query("SELECT set_config('app.current_role', 'user', true)")
      await expect(
        client.query(
          `INSERT INTO payment_installments (id, organization_id, project_id, sequence_no, split_method, amount_cents)
           VALUES ($1, $2, $3, 99, 'pay_in_full', 1)`,
          [createId(), a.orgId, a.projectId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })
})
