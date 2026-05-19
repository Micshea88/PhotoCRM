import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

/**
 * RLS negative tests for `terminology_map`. The application layer is
 * INTENTIONALLY BYPASSED — these tests run raw SQL against a pg client to
 * prove the database enforces org isolation independent of any `where`
 * clauses in queries.ts. If you can satisfy these tests by adding more
 * `where organization_id = $1` in queries, the test is wrong.
 *
 * Pattern: every test uses a single `withRawClient` that ROLLBACKs at the
 * end. Inside that one transaction we seed `organization` rows (no RLS on
 * that table), then change `app.current_org` between writes/reads to
 * simulate cross-org probes. Transaction-local set_config(..., true) lets
 * us switch identity mid-transaction.
 */

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

describe("terminology_map — RLS policy", () => {
  it("hides rows from a probe with a different org context", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO terminology_map
           (id, organization_id, object_key, label_singular, label_plural)
         VALUES ($1, $2, 'project', 'Event', 'Events')`,
        [createId(), orgA],
      )

      // Switch identity to orgB. The row we just inserted into orgA must
      // not be visible — RLS, not a where-clause, is doing this.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      const probe = await client.query("SELECT * FROM terminology_map")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("returns 0 rows when no org context is set (NULL guard)", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)

      // Seed a row under orgA's context.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO terminology_map
           (id, organization_id, object_key, label_singular, label_plural)
         VALUES ($1, $2, 'project', 'Event', 'Events')`,
        [createId(), orgA],
      )

      // Reset context to empty. current_setting('app.current_org', true)
      // returns NULL; NULL = anything is NULL (not true), so no rows visible.
      // This guards against callers who forget runWithOrgContext.
      await client.query("SELECT set_config('app.current_org', '', true)")
      const probe = await client.query("SELECT * FROM terminology_map")
      expect(probe.rows.length).toBe(0)
    })
  })

  it("rejects an INSERT whose organization_id doesn't match app.current_org", async () => {
    await withRawClient(async (client) => {
      const { orgA, orgB } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      // Try to insert a row for orgB while we're scoped to orgA. WITH CHECK
      // (which defaults to the USING expression) must reject this.
      await expect(
        client.query(
          `INSERT INTO terminology_map
             (id, organization_id, object_key, label_singular, label_plural)
           VALUES ($1, $2, 'project', 'Event', 'Events')`,
          [createId(), orgB],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("permits same-org reads (positive control)", async () => {
    await withRawClient(async (client) => {
      const { orgA } = await seedTwoOrgs(client)

      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      await client.query(
        `INSERT INTO terminology_map
           (id, organization_id, object_key, label_singular, label_plural)
         VALUES ($1, $2, 'project', 'Event', 'Events')`,
        [createId(), orgA],
      )

      const probe = await client.query(
        "SELECT object_key, label_singular, label_plural FROM terminology_map",
      )
      expect(probe.rows.length).toBe(1)
      expect(probe.rows[0]).toMatchObject({
        object_key: "project",
        label_singular: "Event",
        label_plural: "Events",
      })
    })
  })
})
