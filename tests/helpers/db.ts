import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { sql } from "drizzle-orm"
import * as schema from "@/db/schema"

export type TestDb = NodePgDatabase<typeof schema>

export async function withTestDb<T>(fn: (db: TestDb) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for integration tests")
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    // Mirror production (safe-action.ts:210 / org-context.ts:122): drop into the
    // NOBYPASSRLS role as the FIRST statement so RLS genuinely applies regardless of
    // what DATABASE_URL connects as — locally pathway_app (already non-bypass), in CI
    // postgres (superuser+BYPASSRLS, where without this every RLS check is a no-op).
    // The connecting role must be app_authenticated or a member of it (0041 grants it
    // to pathway_app; a superuser can SET ROLE unconditionally).
    await client.query("SET LOCAL ROLE app_authenticated")
    const txDb = drizzle(client, { schema })
    try {
      return await fn(txDb)
    } finally {
      await client.query("ROLLBACK")
    }
  } finally {
    client.release()
    await pool.end()
  }
}

/**
 * Set the RLS session settings on the test's transaction. `app.current_org`
 * must be set before any INSERT/UPDATE/DELETE on a table whose RLS policy
 * uses it (i.e., every org-scoped table). `app.current_role` is required
 * by tables with an admin-write gate (rbac); defaults to "owner" so tests
 * pass the gate. `app.current_user_id` is read by the assignment-scoped
 * RLS overlay (photographer/contractor/editor) on contacts/projects/tasks;
 * passing `null` (the default) means "no user" — assignment-scoped role
 * probes will see zero rows by design (fail-closed).
 *
 * `set_config(..., true)` is transaction-local. The test's BEGIN/ROLLBACK
 * envelope means these settings vanish at end of test — no leak.
 */
export async function setOrgContext(
  db: TestDb,
  orgId: string,
  role = "owner",
  userId: string | null = null,
  // app.current_view_all_events (migration 0047) — the visibility flag the
  // assignment-scoped overlay reads instead of the role string. Derived from
  // role by default (role !== 'user' → true), mirroring the production
  // withOrgContext fallback, so sees-all roles keep seeing all. Pass
  // explicitly to probe an override.
  viewAllEvents: boolean = role !== "user",
) {
  await db.execute(sql`SELECT set_config('app.current_org', ${orgId}, true)`)
  await db.execute(sql`SELECT set_config('app.current_role', ${role}, true)`)
  await db.execute(sql`SELECT set_config('app.current_user_id', ${userId ?? ""}, true)`)
  await db.execute(
    sql`SELECT set_config('app.current_view_all_events', ${viewAllEvents ? "true" : "false"}, true)`,
  )
}
