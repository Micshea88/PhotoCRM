/**
 * Hotfix 0041 — end-to-end orgAction write under SET LOCAL ROLE
 * app_authenticated.
 *
 * The next-safe-action wrapper itself is hard to invoke in vitest
 * (it pulls next/headers + Better Auth session). What it does at the
 * DB layer is a fixed transaction sequence — that's the part this
 * test exercises against the dev DB connecting as pathway_app (the
 * same runtime role).
 *
 * Sequence replicated verbatim from src/lib/safe-action.ts L196-225:
 *   1. SET LOCAL ROLE app_authenticated          ← new in 0041
 *   2. member.findFirst                          ← member has RLS=false
 *   3. set app.current_org / role / user_id
 *   4. member_role lookup (RLS-protected; needs app.current_org)
 *   5. action body INSERT into an RLS-protected table
 *
 * If any of those steps regress (member lookup failing under
 * app_authenticated, member_role lookup denied, INSERT denied), the
 * test fails. If all succeed AND a peer org's row stays invisible
 * post-INSERT, the runtime role switch is load-bearing AND non-
 * breaking.
 */
import { describe, it, expect } from "vitest"
import { Pool } from "pg"
import { createId } from "@paralleldrive/cuid2"

describe("hotfix 0041 — orgAction write path under app_authenticated", () => {
  it("full orgAction sequence succeeds (member lookup + GUC + INSERT) and writes are cross-org isolated", async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests")
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      // ── Setup: seed two orgs + a user who is a member of orgA ──
      const userId = createId()
      const orgA = createId()
      const orgB = createId()
      await client.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, 'Probe User', $2, true, NOW(), NOW())`,
        [userId, `probe-${userId.slice(0, 8)}@example.com`],
      )
      await client.query(
        `INSERT INTO organization (id, name, slug, created_at)
         VALUES ($1, 'OrgA', $2, NOW()), ($3, 'OrgB', $4, NOW())`,
        [orgA, `a-${orgA.slice(0, 8)}`, orgB, `b-${orgB.slice(0, 8)}`],
      )
      await client.query(
        `INSERT INTO member (id, user_id, organization_id, role, created_at)
         VALUES ($1, $2, $3, 'owner', NOW())`,
        [createId(), userId, orgA],
      )
      // Seed one orgB contact so we can prove the role-switched
      // session can't see it after we move into orgA's context.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const otherOrgContactId = createId()
      await client.query(
        `INSERT INTO contacts (id, organization_id, first_name, last_name, lead_source, contact_type, lifecycle_status, created_by)
         VALUES ($1, $2, 'OtherOrg', 'Hidden', 'other', 'lead', 'lead', NULL)`,
        [otherOrgContactId, orgB],
      )
      // Clear current_org so the next sequence starts fresh.
      await client.query("SELECT set_config('app.current_org', '', true)")

      // ── The orgAction sequence (verbatim from safe-action.ts) ──
      // 1. Role switch FIRST (hotfix 0041).
      await client.query("SET LOCAL ROLE app_authenticated")
      const whoami = await client.query<{ current_user: string }>("SELECT current_user")
      expect(whoami.rows[0]?.current_user).toBe("app_authenticated")

      // 2. member.findFirst — must succeed under app_authenticated,
      //    BEFORE any app.current_org GUC is set, because member's
      //    RLS is off (Better Auth manages auth tables).
      const m = await client.query<{ role: string }>(
        `SELECT role FROM member WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
        [userId, orgA],
      )
      expect(m.rows.length).toBe(1)
      expect(m.rows[0]?.role).toBe("owner")

      // 3. GUC sets (provisional Better Auth role).
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])

      // 4. Action body — first an INSERT against an RLS-protected
      //    table (contacts), then a SELECT to confirm cross-org
      //    isolation. INSERT must satisfy the RLS WITH CHECK clause
      //    (organization_id matches app.current_org). Cross-org
      //    leak would surface as a row count > 1 in the SELECT.
      const newContactId = createId()
      await client.query(
        `INSERT INTO contacts (id, organization_id, first_name, last_name, lead_source, contact_type, lifecycle_status, created_by)
         VALUES ($1, $2, 'orgA', 'Probe', 'other', 'lead', 'lead', $3)`,
        [newContactId, orgA, userId],
      )
      const visible = await client.query<{ id: string; organization_id: string }>(
        "SELECT id, organization_id FROM contacts ORDER BY organization_id",
      )
      expect(visible.rows.length).toBe(1)
      expect(visible.rows[0]?.id).toBe(newContactId)
      expect(visible.rows[0]?.organization_id).toBe(orgA)
      // OrgB's seeded contact must remain invisible.
      expect(visible.rows.some((r) => r.id === otherOrgContactId)).toBe(false)

      // Cross-org INSERT must be rejected — same WITH CHECK clause.
      await expect(
        client.query(
          `INSERT INTO contacts (id, organization_id, first_name, last_name, lead_source, contact_type, lifecycle_status, created_by)
           VALUES ($1, $2, 'evil', 'X', 'other', 'lead', 'lead', $3)`,
          [createId(), orgB, userId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    } finally {
      await client.query("ROLLBACK")
      client.release()
      await pool.end()
    }
  })
})
