import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { db } from "@/lib/db"
import type * as schema from "@/db/schema"
import type { ExtendedRole } from "@/modules/rbac/types"

/**
 * Loose handle type that accepts both the pool-backed `db` and a
 * `PgTransaction` from `db.transaction(...)`. Mirrors the audit module's
 * `AuditDb` pattern (src/modules/audit/audit.ts) so query helpers don't
 * have to care which one they're given.
 */
type DbHandle = NodePgDatabase<typeof schema>

/**
 * Per-request org/role/user context, plumbed through AsyncLocalStorage so
 * that read-path functions in `queries.ts` files don't have to thread
 * `orgId` / `userId` through every signature.
 *
 * - WRITE PATH: `orgAction` (src/lib/safe-action.ts) opens a transaction
 *   and sets `app.current_org` / `app.current_role` / `app.current_user_id`
 *   as transaction-local settings. Action code uses `ctx.db` (the tx
 *   client) directly. RLS policies on org-scoped tables read those settings
 *   via current_setting().
 *
 * - READ PATH: `queries.ts` functions called from RSCs, route handlers,
 *   or cron jobs use `withOrgContext(fn)` below. It pulls the context from
 *   AsyncLocalStorage, opens a fresh transaction, sets the same settings,
 *   and runs `fn(tx)`. The caller at the request entry point is responsible
 *   for wrapping itself in `runWithOrgContext()` after resolving the session.
 *
 * If a `queries.ts` function is called outside any org context (no
 * `runWithOrgContext` in scope and no `override`), `withOrgContext` throws.
 * This is intentional: silent fallthrough would silently return zero rows
 * once RLS is enabled, hiding the wiring bug.
 *
 * `role` is the extended 8-role (Requirements §5). `userId` is plumbed so
 * the assignment-scoped RLS overlay on contacts/projects/tasks can join
 * to project_photographers / tasks.assignee_user_id via
 * `current_setting('app.current_user_id', true)`.
 */

export interface OrgContext {
  orgId: string
  role: ExtendedRole
  userId: string
  /**
   * Whether this user sees ALL of the org's contacts/events/tasks (true) or
   * only assignment-scoped rows (false) — the `view_all_events` permission,
   * read by the assignment-scoped RLS via `app.current_view_all_events`.
   *
   * OPTIONAL: when omitted, `withOrgContext` falls back to the role-based
   * default (`role !== 'user'`), which reproduces the pre-permission-flag
   * behavior exactly and is fail-closed (a missing value scopes DOWN, never
   * a leak). Entry points that must honor per-user OVERRIDES (orgAction, the
   * contact-detail loader) resolve the real value via
   * `resolvePermissionInTx` / `hasPermission` and pass it here.
   */
  viewAllEvents?: boolean
}

/**
 * Effective "sees everything" value for a context: the explicit flag when
 * provided, else the role-based default (`role !== 'user'`). Centralized so
 * the GUC set in `withOrgContext` and any future reader agree.
 */
function effectiveViewAllEvents(ctx: OrgContext): boolean {
  return ctx.viewAllEvents ?? ctx.role !== "user"
}

const storage = new AsyncLocalStorage<OrgContext>()

/**
 * Establish the per-request org context. Call this from a request entry point
 * (typically an authenticated RSC layout) after resolving the Better Auth
 * session. Downstream reads issued via `withOrgContext()` will see this ctx.
 */
export function runWithOrgContext<T>(ctx: OrgContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn)
}

/**
 * Read the current org context, if any. Useful for instrumentation; prefer
 * `withOrgContext` for actual queries so the RLS settings are guaranteed.
 */
export function getOrgContext(): OrgContext | undefined {
  return storage.getStore()
}

/**
 * Run a read inside a Postgres transaction with `app.current_org` and
 * `app.current_role` set as transaction-local settings. The provided `tx`
 * is bound to the transaction; do not stash it outside the callback.
 *
 * Throws if there is no org context in scope (no `runWithOrgContext` ancestor
 * and no explicit `override`). Tests and jobs may pass `override` to bypass
 * AsyncLocalStorage.
 */
export async function withOrgContext<T>(
  fn: (tx: DbHandle) => Promise<T>,
  override?: OrgContext,
): Promise<T> {
  const ctx = override ?? storage.getStore()
  if (!ctx) {
    throw new Error(
      "withOrgContext: no org context in scope. Call runWithOrgContext() at " +
        "the request entry point, or pass an explicit override (tests/jobs only).",
    )
  }
  return db.transaction(async (tx) => {
    // CRITICAL — hotfix 0041: the connection role in prod is
    // BYPASSRLS (Neon's owner). Without this role switch, every
    // org-scoped RLS policy is silently inert and a user in org A
    // can read every row in org B. SET LOCAL ROLE drops us into the
    // NOBYPASSRLS app_authenticated role for the duration of THIS
    // transaction only — commit/rollback automatically reverts.
    // MUST come BEFORE the app.current_org GUC sets; otherwise the
    // policy check on subsequent statements still runs as the
    // bypass role.
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
    await tx.execute(sql`SELECT set_config('app.current_org', ${ctx.orgId}, true)`)
    await tx.execute(sql`SELECT set_config('app.current_role', ${ctx.role}, true)`)
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`)
    await tx.execute(
      sql`SELECT set_config('app.current_view_all_events', ${effectiveViewAllEvents(ctx) ? "true" : "false"}, true)`,
    )
    return fn(tx)
  })
}
