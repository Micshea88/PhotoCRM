/**
 * Hotfix 0041 — cross-org isolation tests for the new
 * `SET LOCAL ROLE app_authenticated` runtime pattern.
 *
 * Background: every org-scoped table already has a FORCE ROW LEVEL
 * SECURITY policy filtering by `app.current_org`. In dev those
 * policies enforced (the connection role pathway_app is NOBYPASSRLS).
 * In prod they were silently inert because the connection role is
 * Neon's owner (BYPASSRLS) — confirmed live by Mike when a user in
 * Shanzy Studio saw all 12 contacts in K&K Photography.
 *
 * Fix: introduce a dedicated NOBYPASSRLS role `app_authenticated`
 * and `SET LOCAL ROLE` into it as the FIRST statement in both
 * orgAction (write path) and withOrgContext (read path) transactions.
 *
 * These tests assert the DB-level invariants of that pattern. They
 * connect via the same DATABASE_URL the app uses (pathway_app in dev)
 * and SET LOCAL ROLE the same way runtime code does — so any
 * regression in the SQL contract surfaces here.
 */
import { describe, it, expect } from "vitest"
import { Pool, type PoolClient } from "pg"
import { createId } from "@paralleldrive/cuid2"

async function withAppAuthClient<T>(
  fn: (client: PoolClient, opts: { orgA: string; orgB: string }) => Promise<T>,
  opts: { applyGuc?: boolean } = { applyGuc: true },
): Promise<T> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for integration tests")
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    // Migration 0047: the contacts overlay reads app.current_view_all_events
    // instead of the role string. Default it on (full visibility) so the
    // owner-context seeds + the applyGuc owner context insert/read as before;
    // org isolation is still enforced by the org-clamp, which these tests probe.
    await client.query("SELECT set_config('app.current_view_all_events', 'true', true)")
    try {
      // Seed two orgs + one contact in each. The seeds must happen
      // BEFORE the role switch — RLS is FORCE, so inserts under
      // app_authenticated without a matching app.current_org would
      // fail. The setup runs as the connection role (pathway_app)
      // which is NOBYPASS but the transaction has no GUC yet, so the
      // policies' USING clause evaluates to NULL → we'd be denied.
      // Instead: temporarily set the GUC per insert, or seed under
      // the connection role with the GUC bound for each org's data.
      const orgA = createId()
      const orgB = createId()
      await client.query(
        `INSERT INTO organization (id, name, slug, created_at)
         VALUES ($1, 'A', $2, NOW()), ($3, 'B', $4, NOW())`,
        [orgA, `a-${orgA.slice(0, 8)}`, orgB, `b-${orgB.slice(0, 8)}`],
      )
      // Insert one contact per org. RLS WITH CHECK validates the
      // inserted row's organization_id against app.current_org, so
      // we set the GUC per insert.
      const contactA = createId()
      const contactB = createId()
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO contacts (id, organization_id, first_name, last_name, lead_source, contact_type, lifecycle_status, created_by)
         VALUES ($1, $2, 'Test', 'Probe', 'other', 'lead', 'lead', NULL)`,
        [contactA, orgA],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      await client.query(
        `INSERT INTO contacts (id, organization_id, first_name, last_name, lead_source, contact_type, lifecycle_status, created_by)
         VALUES ($1, $2, 'Test', 'Probe', 'other', 'lead', 'lead', NULL)`,
        [contactB, orgB],
      )

      // NOW switch into app_authenticated — this mirrors what the
      // runtime does at the top of every withOrgContext / orgAction
      // transaction. Optional GUC reset clears the current_org so
      // the test can choose what context the role switch operates
      // under (test #2 wants no-context).
      await client.query("SET LOCAL ROLE app_authenticated")
      if (opts.applyGuc !== false) {
        // applyGuc=true is the runtime default: orgA's context.
        await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
        await client.query("SELECT set_config('app.current_role', $1, true)", ["owner"])
        await client.query("SELECT set_config('app.current_user_id', $1, true)", [""])
      } else {
        // Reset GUC so no org is in scope — proves RLS denies in
        // the unset-GUC case.
        await client.query("SELECT set_config('app.current_org', '', true)")
      }

      return await fn(client, { orgA, orgB })
    } finally {
      await client.query("ROLLBACK")
    }
  } finally {
    client.release()
    await pool.end()
  }
}

describe("hotfix 0041 — runtime role switch enforces org isolation", () => {
  it("orgA context via SET LOCAL ROLE app_authenticated sees ONLY orgA rows", async () => {
    await withAppAuthClient(async (client, { orgA, orgB }) => {
      // Verify current_user is app_authenticated — the role switch
      // actually took effect.
      const role = await client.query<{ current_user: string }>("SELECT current_user")
      expect(role.rows[0]?.current_user).toBe("app_authenticated")

      // Probe contacts — should see exactly one row (orgA's).
      const all = await client.query<{ id: string; organization_id: string }>(
        "SELECT id, organization_id FROM contacts ORDER BY organization_id",
      )
      expect(all.rows.length).toBe(1)
      expect(all.rows[0]?.organization_id).toBe(orgA)
      expect(all.rows[0]?.organization_id).not.toBe(orgB)
    })
  })

  it("SET LOCAL ROLE app_authenticated without app.current_org returns 0 rows from org-scoped tables", async () => {
    // applyGuc=false — same role switch as the runtime, but the
    // GUC is unset. The RLS policy `organization_id = current_setting(...)`
    // evaluates to NULL → policy denies. Proves the policies are
    // load-bearing once the bypass is gone (and that the runtime
    // MUST set the GUC, not optional).
    await withAppAuthClient(
      async (client) => {
        const role = await client.query<{ current_user: string }>("SELECT current_user")
        expect(role.rows[0]?.current_user).toBe("app_authenticated")

        // Multiple org-scoped tables should all return zero.
        const contacts = await client.query("SELECT id FROM contacts")
        const calls = await client.query("SELECT id FROM call_log")
        const emails = await client.query("SELECT id FROM email_log")
        expect(contacts.rows.length).toBe(0)
        expect(calls.rows.length).toBe(0)
        expect(emails.rows.length).toBe(0)
      },
      { applyGuc: false },
    )
  })

  it("from inside app_authenticated, SET LOCAL ROLE to a privileged role FAILS", async () => {
    // The escalation attempt Mike asked us to test. In dev:
    //   - session_user = pathway_app (the connection role)
    //   - pathway_app is a member of app_authenticated → SET LOCAL
    //     ROLE app_authenticated succeeds (this is the runtime path)
    //   - pathway_app is NOT a member of postgres → SET LOCAL ROLE
    //     postgres FAILS with "permission denied to set role"
    //   - neondb_owner does not exist in dev → SET LOCAL ROLE
    //     neondb_owner FAILS with "role does not exist"
    // Either failure proves the role boundary holds.
    await withAppAuthClient(async (client) => {
      // postgres escalation — pathway_app is not a member of postgres.
      await expect(client.query("SET LOCAL ROLE postgres")).rejects.toThrow(
        /permission denied to set role|must be (?:able to set role|member of)/i,
      )
    })
    // Use a fresh connection for the neondb_owner probe because the
    // previous one is rolled back (and the txn was poisoned by the
    // failed SET ROLE).
    await withAppAuthClient(async (client) => {
      await expect(client.query("SET LOCAL ROLE neondb_owner")).rejects.toThrow(
        /role "neondb_owner" does not exist|permission denied to set role/i,
      )
    })
  })
})
