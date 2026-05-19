import { Pool, type PoolClient } from "pg"

/**
 * Raw-pg helper for RLS negative tests. The app layer is intentionally
 * bypassed: we open a direct pg client, BEGIN a transaction, set
 * `app.current_org` and `app.current_role` as transaction-local settings,
 * and hand the test a `PoolClient` for raw `client.query(...)` calls.
 *
 * The test asserts what the *database* allows under those settings — no
 * Drizzle, no orgAction, no module code. A test that uses this helper and
 * sees zero rows for a wrong-org/wrong-role probe proves that RLS itself
 * (not the app's where-clauses) enforces isolation.
 *
 * Caller responsibility:
 *   - Only call from integration tests; DATABASE_URL must point at the dev
 *     Postgres (the production-credential guard in src/lib/db.ts does not
 *     gate this helper because we connect through `pg` directly).
 *   - Pass `orgId` as a string (Postgres `set_config` is text-only).
 *   - The transaction always ROLLBACKs at the end; tests cannot mutate state.
 */
export async function withRawOrgContext<T>(
  args: { orgId: string; role: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for RLS integration tests")
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    try {
      await client.query("SELECT set_config('app.current_org', $1, true)", [args.orgId])
      await client.query("SELECT set_config('app.current_role', $1, true)", [args.role])
      return await fn(client)
    } finally {
      await client.query("ROLLBACK")
    }
  } finally {
    client.release()
    await pool.end()
  }
}

/**
 * Convenience: the same shape as `withRawOrgContext` but with NO RLS settings
 * applied. Use this when the test needs to seed data under an admin role (or
 * to verify what the DB looks like with no `app.current_org` in scope —
 * which under a correctly-configured policy means "see nothing").
 */
export async function withRawClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for RLS integration tests")
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    try {
      return await fn(client)
    } finally {
      await client.query("ROLLBACK")
    }
  } finally {
    client.release()
    await pool.end()
  }
}
