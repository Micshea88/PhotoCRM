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
 * pass the gate.
 *
 * `set_config(..., true)` is transaction-local. The test's BEGIN/ROLLBACK
 * envelope means these settings vanish at end of test — no leak.
 */
export async function setOrgContext(db: TestDb, orgId: string, role = "owner") {
  await db.execute(sql`SELECT set_config('app.current_org', ${orgId}, true)`)
  await db.execute(sql`SELECT set_config('app.current_role', ${role}, true)`)
}
