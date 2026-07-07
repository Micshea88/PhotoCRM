/**
 * Cross-org RLS tests for the 7 tenant tables that gained FORCE org-isolation
 * RLS in migration 0061 (Task T1.1 — multi-tenant isolation):
 *   files, items, audit_log, org_preferences, file_share_links,
 *   file_share_link_events, file_scan_diagnostics.
 *
 * Model: the canonical org-isolation surface used by every drift-zone sibling
 * (contacts / email_log / call_log) — a single FOR-ALL policy checking the org
 * column against the `app.current_org` GUC. We connect as the dev app role
 * (pathway_app, NOBYPASSRLS) via raw pg and drive the GUC exactly like the
 * runtime, so any regression in the SQL contract surfaces here.
 *
 * For every table: seed org B's row (under org B's GUC), switch to org A, and
 * assert A cannot SELECT / UPDATE / DELETE B's row and cannot INSERT a row
 * carrying B's org id. Plus a share-link tampered/foreign-token probe and a
 * faq_entries global-content assertion.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"
import { getShareLinkByToken } from "@/modules/files/share-link-access"

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

function setOrg(client: PoolClient, orgId: string) {
  return client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
}

/**
 * Assert a write is denied by RLS. A failed statement aborts the surrounding
 * transaction, so we wrap it in a SAVEPOINT and ROLLBACK TO it on error — this
 * keeps the test's outer transaction usable for later assertions.
 */
async function expectBlocked(client: PoolClient, text: string, params: unknown[] = []) {
  await client.query("SAVEPOINT sp")
  let err: unknown
  try {
    await client.query(text, params)
  } catch (e) {
    err = e
  }
  await client.query("ROLLBACK TO SAVEPOINT sp")
  expect(err).toBeDefined()
  expect(String(err)).toMatch(/row-level security|policy/i)
}

/** Seed one org-B file and return its id (under org B's GUC). */
async function seedFile(client: PoolClient, orgId: string) {
  const id = createId()
  await setOrg(client, orgId)
  await client.query(
    `INSERT INTO files (id, organization_id, pathname, url, content_type, size_bytes)
     VALUES ($1, $2, 'b.jpg', 'https://blob/b.jpg', 'image/jpeg', 10)`,
    [id, orgId],
  )
  return id
}

describe("RLS — files", () => {
  it("org A cannot SELECT/UPDATE/DELETE org B's file and cannot INSERT with B's id", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      const fileB = await seedFile(client, orgB)

      await setOrg(client, orgA)
      expect((await client.query("SELECT * FROM files")).rows.length).toBe(0)
      expect((await client.query("UPDATE files SET pathname = 'x'")).rowCount).toBe(0)
      expect((await client.query("DELETE FROM files")).rowCount).toBe(0)
      await expectBlocked(
        client,
        `INSERT INTO files (id, organization_id, pathname, url, content_type, size_bytes)
           VALUES ($1, $2, 'a.jpg', 'https://blob/a.jpg', 'image/jpeg', 5)`,
        [createId(), orgB],
      )

      // positive control: org B sees its own file
      await setOrg(client, orgB)
      const seen = await client.query("SELECT id FROM files WHERE id = $1", [fileB])
      expect(seen.rows.length).toBe(1)
    })
  })
})

describe("RLS — items", () => {
  it("isolates items across orgs", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await setOrg(client, orgB)
      await client.query(
        `INSERT INTO items (id, organization_id, name) VALUES ($1, $2, 'B item')`,
        [createId(), orgB],
      )

      await setOrg(client, orgA)
      expect((await client.query("SELECT * FROM items")).rows.length).toBe(0)
      expect((await client.query("UPDATE items SET name = 'x'")).rowCount).toBe(0)
      expect((await client.query("DELETE FROM items")).rowCount).toBe(0)
      await expectBlocked(
        client,
        `INSERT INTO items (id, organization_id, name) VALUES ($1, $2, 'A')`,
        [createId(), orgB],
      )
    })
  })
})

describe("RLS — audit_log", () => {
  it("isolates audit rows across orgs", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await setOrg(client, orgB)
      await client.query(
        `INSERT INTO audit_log (id, organization_id, action) VALUES ($1, $2, 'x.created')`,
        [createId(), orgB],
      )

      await setOrg(client, orgA)
      expect((await client.query("SELECT * FROM audit_log")).rows.length).toBe(0)
      expect((await client.query("DELETE FROM audit_log")).rowCount).toBe(0)
      await expectBlocked(
        client,
        `INSERT INTO audit_log (id, organization_id, action) VALUES ($1, $2, 'y.created')`,
        [createId(), orgB],
      )
    })
  })
})

describe("RLS — org_preferences", () => {
  it("isolates org preferences across orgs", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await setOrg(client, orgB)
      await client.query(`INSERT INTO org_preferences (id, organization_id) VALUES ($1, $2)`, [
        createId(),
        orgB,
      ])

      await setOrg(client, orgA)
      expect((await client.query("SELECT * FROM org_preferences")).rows.length).toBe(0)
      expect(
        (await client.query("UPDATE org_preferences SET default_share_link_expiration = '1 week'"))
          .rowCount,
      ).toBe(0)
      expect((await client.query("DELETE FROM org_preferences")).rowCount).toBe(0)
      await expectBlocked(
        client,
        `INSERT INTO org_preferences (id, organization_id) VALUES ($1, $2)`,
        [createId(), orgB],
      )
    })
  })
})

describe("RLS — file_share_links", () => {
  it("isolates share links across orgs", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      const fileB = await seedFile(client, orgB)
      const linkB = createId()
      await client.query(
        `INSERT INTO file_share_links (id, organization_id, file_id, token)
         VALUES ($1, $2, $3, $4)`,
        [linkB, orgB, fileB, createId()],
      )

      await setOrg(client, orgA)
      expect((await client.query("SELECT * FROM file_share_links")).rows.length).toBe(0)
      expect((await client.query("UPDATE file_share_links SET active = false")).rowCount).toBe(0)
      expect((await client.query("DELETE FROM file_share_links")).rowCount).toBe(0)
      await expectBlocked(
        client,
        `INSERT INTO file_share_links (id, organization_id, file_id, token)
           VALUES ($1, $2, $3, $4)`,
        [createId(), orgB, fileB, createId()],
      )
    })
  })
})

describe("RLS — file_share_link_events", () => {
  it("isolates share-link events across orgs", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      const fileB = await seedFile(client, orgB)
      const linkB = createId()
      await client.query(
        `INSERT INTO file_share_links (id, organization_id, file_id, token)
         VALUES ($1, $2, $3, $4)`,
        [linkB, orgB, fileB, createId()],
      )
      await client.query(
        `INSERT INTO file_share_link_events (id, organization_id, share_link_id, event_type)
         VALUES ($1, $2, $3, 'opened')`,
        [createId(), orgB, linkB],
      )

      await setOrg(client, orgA)
      expect((await client.query("SELECT * FROM file_share_link_events")).rows.length).toBe(0)
      expect((await client.query("DELETE FROM file_share_link_events")).rowCount).toBe(0)
      await expectBlocked(
        client,
        `INSERT INTO file_share_link_events (id, organization_id, share_link_id, event_type)
           VALUES ($1, $2, $3, 'downloaded')`,
        [createId(), orgB, linkB],
      )
    })
  })
})

describe("RLS — file_scan_diagnostics (org_id column)", () => {
  it("isolates scan diagnostics across orgs", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)
      await setOrg(client, orgB)
      await client.query(
        `INSERT INTO file_scan_diagnostics (org_id, step) VALUES ($1, 'scan_status_updated')`,
        [orgB],
      )

      await setOrg(client, orgA)
      expect((await client.query("SELECT * FROM file_scan_diagnostics")).rows.length).toBe(0)
      expect((await client.query("DELETE FROM file_scan_diagnostics")).rowCount).toBe(0)
      await expectBlocked(
        client,
        `INSERT INTO file_scan_diagnostics (org_id, step) VALUES ($1, 'poll_received')`,
        [orgB],
      )
      // A null-org insert is also denied under a scoped role (null = current_setting
      // is never true). Prod null-org diagnostic rows land via the BYPASSRLS owner
      // connection (logScanStep) and are invisible to every scoped reader by design.
      await expectBlocked(
        client,
        `INSERT INTO file_scan_diagnostics (org_id, step) VALUES (NULL, 'x')`,
      )
    })
  })
})

describe("RLS — share-link tampered/foreign token cannot reach another org's file", () => {
  it("org A's context cannot resolve org B's link+file even with B's token; A's own token works", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      // Org A: file + link (token tokA)
      const fileA = await seedFile(client, orgA)
      const tokA = createId()
      await client.query(
        `INSERT INTO file_share_links (id, organization_id, file_id, token)
         VALUES ($1, $2, $3, $4)`,
        [createId(), orgA, fileA, tokA],
      )
      // Org B: file + link (token tokB)
      const fileB = await seedFile(client, orgB)
      const tokB = createId()
      await client.query(
        `INSERT INTO file_share_links (id, organization_id, file_id, token)
         VALUES ($1, $2, $3, $4)`,
        [createId(), orgB, fileB, tokB],
      )

      // Under org A: the join used by the public download path.
      await setOrg(client, orgA)
      const foreign = await client.query(
        `SELECT f.id FROM file_share_links l
         JOIN files f ON f.id = l.file_id
         WHERE l.token = $1`,
        [tokB],
      )
      expect(foreign.rows.length).toBe(0) // org B's token is unreachable from org A

      const legit = await client.query<{ id: string }>(
        `SELECT f.id FROM file_share_links l
         JOIN files f ON f.id = l.file_id
         WHERE l.token = $1`,
        [tokA],
      )
      expect(legit.rows.length).toBe(1)
      expect(legit.rows[0]?.id).toBe(fileA)

      // A random/invalid token resolves to nothing.
      const random = await client.query(`SELECT 1 FROM file_share_links WHERE token = $1`, [
        createId(),
      ])
      expect(random.rows.length).toBe(0)
    })
  })

  it("getShareLinkByToken returns null for a random/invalid token", async () => {
    // Exercises the real public-path resolver: a nonexistent token → null.
    expect(await getShareLinkByToken(createId())).toBeNull()
  })
})

describe("RLS — user_preferences (user-scoped, FORCE RLS)", () => {
  it("user A under app_authenticated cannot read user B's preferences (cross-user isolation)", async () => {
    // This test verifies FORCE ROW LEVEL SECURITY on user_preferences works
    // correctly: even under the app_authenticated role (which is what the
    // runtime switches into via SET LOCAL ROLE), user A cannot see user B's rows.
    //
    // user_preferences uses app.current_user_id (not app.current_org) as the
    // RLS discriminator. We seed a user B row, switch to user A context, and
    // assert 0 rows visible.
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)
      const userA = createId()
      const userB = createId()

      // Seed both users into the user table (required by FK).
      await client.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, 'User A', $2, true, NOW(), NOW()),
                ($3, 'User B', $4, true, NOW(), NOW())`,
        [userA, `a-${userA.slice(0, 8)}@example.com`, userB, `b-${userB.slice(0, 8)}@example.com`],
      )

      // Seed a preference row for user B. We set app.current_user_id to userB
      // so the RLS WITH CHECK policy allows the insert.
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userB])
      await client.query(
        `INSERT INTO user_preferences (id, user_id, organization_id, key, value)
         VALUES ($1, $2, NULL, 'nav_collapsed', 'true'::jsonb)`,
        [createId(), userB],
      )

      // Switch to app_authenticated (the runtime role). This is the role that
      // FORCE RLS applies to; without FORCE, the owner bypasses it in prod.
      await client.query("SET LOCAL ROLE app_authenticated")

      // Switch context to user A. User A should see 0 rows because the
      // SELECT policy requires user_id = current_setting('app.current_user_id').
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userA])
      const rows = await client.query("SELECT id FROM user_preferences WHERE user_id = $1", [userB])
      expect(rows.rows.length).toBe(0)

      // Positive control: switch to user B's context — B sees its own row.
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userB])
      const ownRows = await client.query("SELECT id FROM user_preferences")
      expect(ownRows.rows.length).toBe(1)

      // Verify orgA is bound (suppress TS unused variable warning) — seedTwoOrgs
      // creates two orgs; orgA is captured to keep the helper signature uniform.
      void orgA
    })
  })
})

describe("faq_entries — GLOBAL content (no org, no RLS)", () => {
  it("has no RLS policy and is readable without any org context", async () => {
    await withRawClient(async (client) => {
      const policies = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'faq_entries'",
      )
      expect(policies.rows[0]?.n).toBe(0)

      const id = createId()
      await client.query(`INSERT INTO faq_entries (id, question, answer) VALUES ($1, 'Q?', 'A.')`, [
        id,
      ])
      // No app.current_org set — a global table is still readable.
      const r = await client.query("SELECT id FROM faq_entries WHERE id = $1", [id])
      expect(r.rows.length).toBe(1)
    })
  })
})
