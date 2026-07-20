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
/**
 * THE durable guarantee for the whole RLS suite. `SET LOCAL ROLE app_authenticated`
 * (NOBYPASSRLS) as the FIRST statement of the transaction — exactly what production
 * does at the top of every read (`org-context.ts:122`) and write (`safe-action.ts:210`)
 * transaction. This makes every probe execute under the non-bypass role REGARDLESS of
 * what `DATABASE_URL` connects as:
 *   - locally the connection is `pathway_app` (already NOBYPASSRLS, and a member of
 *     `app_authenticated` via migration `0041`) → the switch drops into an equivalent
 *     non-bypass role; behaviour is unchanged (the suite was already genuine locally).
 *   - in CI the connection is `postgres` (SUPERUSER + BYPASSRLS) → WITHOUT this switch
 *     every FORCE-RLS policy is a no-op and the isolation assertions pass vacuously on
 *     an empty table / fail falsely on a seeded one. WITH it, RLS genuinely applies.
 * A future bad env var repointing `DATABASE_URL` at a bypass role can no longer make the
 * suite vacuous — the HELPER, not the connection string, is the guarantee.
 *
 * Seeding runs under `app_authenticated` too, and that is safe/proven: the tests have
 * always seeded under a non-bypass role (`pathway_app`) locally, setting `app.current_org`
 * before each org-scoped insert so the policy WITH CHECK passes. (This is why the
 * "seed as the connection role THEN switch" split that `withAppAuthClient` uses is
 * unnecessary in the shared helpers.)
 */
async function switchToAppRole(client: PoolClient): Promise<void> {
  await client.query("SET LOCAL ROLE app_authenticated")
}

export async function withRawOrgContext<T>(
  args: { orgId: string; role: string; userId?: string | null; viewAllEvents?: boolean },
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
      await switchToAppRole(client)
      await client.query("SELECT set_config('app.current_org', $1, true)", [args.orgId])
      await client.query("SELECT set_config('app.current_role', $1, true)", [args.role])
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [args.userId ?? ""])
      // Migration 0047: the assignment-scoped overlay reads this flag, not the
      // role string. Derive from role (role !== 'user' → true), mirroring the
      // production withOrgContext fallback; override explicitly when probing.
      await client.query("SELECT set_config('app.current_view_all_events', $1, true)", [
        (args.viewAllEvents ?? args.role !== "user") ? "true" : "false",
      ])
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
 * Convenience: the same shape as `withRawOrgContext` but with NO org/role RLS
 * settings applied. Use this when the test seeds/probes by setting
 * `app.current_org` itself (or to verify that with no org in scope a correct
 * policy means "see nothing").
 *
 * One default IS applied: `app.current_view_all_events='true'`. Migration 0047
 * re-keyed the assignment-scoped overlay (contacts/projects/tasks) from the
 * role string onto this flag; before it, an unset role meant "sees all" via
 * `NOT IN ('user')`. Defaulting the flag to 'true' restores that full-
 * visibility baseline for raw seeders that don't set a role, so existing
 * cross-org / no-context / financial-role tests behave unchanged. Org
 * isolation is NOT affected (the org-clamp still governs); a test probing
 * assignment-scoping sets `app.current_view_all_events='false'` explicitly.
 */
export async function withRawClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for RLS integration tests")
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await switchToAppRole(client)
    await client.query("SELECT set_config('app.current_view_all_events', 'true', true)")
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
