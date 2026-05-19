import "server-only"
import { createSafeActionClient, DEFAULT_SERVER_ERROR_MESSAGE } from "next-safe-action"
import { z } from "zod"
import { headers } from "next/headers"
import * as Sentry from "@sentry/nextjs"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { log } from "@/lib/log"
import { member } from "@/modules/auth/schema"
import { lookupExtendedMemberRole } from "@/modules/rbac/queries"
import {
  extendedFromBetterAuth,
  type ExtendedRole,
  type BetterAuthRole,
} from "@/modules/rbac/types"
import { and, eq, sql } from "drizzle-orm"

export class ActionError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "NO_ACTIVE_ORG"
      | "NOT_FOUND"
      | "VALIDATION"
      | "CONFLICT",
    message: string,
  ) {
    super(message)
    this.name = "ActionError"
  }
}

const baseClient = createSafeActionClient({
  defineMetadataSchema() {
    return z.object({
      actionName: z.string(),
    })
  },
  handleServerError(e) {
    if (e instanceof ActionError) {
      return e.message
    }
    // Unexpected errors: capture to Sentry AND log structured. The user gets
    // the generic DEFAULT_SERVER_ERROR_MESSAGE so internals don't leak.
    Sentry.captureException(e)
    log.error(
      { err: e instanceof Error ? { message: e.message, stack: e.stack } : e },
      "safe-action error",
    )
    return DEFAULT_SERVER_ERROR_MESSAGE
  },
})

/**
 * IMPORTANT — every action chain MUST include `.inputSchema(zodSchema)`.
 *
 * `next-safe-action` does NOT enforce input validation by itself; skipping
 * `.inputSchema()` means the action accepts any shape from the client. The
 * `scripts/check-actions.mjs` static check (run by `pnpm verify --tier=1`)
 * will fail the build if you forget. See `src/modules/items/actions.ts` for
 * the canonical pattern.
 */

/** Action with no auth requirements (rare — only for genuinely public mutations). */
export const action = baseClient

/** Action requiring an authenticated session. */
export const authAction = baseClient.use(async ({ next }) => {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session?.user) {
    throw new ActionError("UNAUTHENTICATED", "You must be signed in.")
  }
  const ipAddress =
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? reqHeaders.get("x-real-ip") ?? null
  const userAgent = reqHeaders.get("user-agent") ?? null
  return next({ ctx: { session, db, ipAddress, userAgent } })
})

/**
 * Action requiring an authenticated session AND an active organization.
 *
 * RLS load-bearing: the action body runs inside a Postgres transaction so
 * `app.current_org` and `app.current_role` can be set as TRANSACTION-LOCAL
 * settings (third arg = is_local=true). Outside a tx those settings would
 * leak to the next pool checkout. Per-table RLS policies read these via
 * current_setting() to enforce org/role scoping.
 *
 * `ctx.db` is REPLACED by the tx client inside the action; code that bypasses
 * `ctx.db` (e.g. importing `db` from `@/lib/db` directly) bypasses the RLS
 * context and will see zero rows from any RLS-protected table.
 */
export const orgAction = authAction.use(async ({ next, ctx }) => {
  const activeOrgId = ctx.session.session.activeOrganizationId
  if (!activeOrgId) {
    throw new ActionError("NO_ACTIVE_ORG", "Select or create an organization first.")
  }
  return ctx.db.transaction(async (tx) => {
    const m = await tx.query.member.findFirst({
      where: and(eq(member.userId, ctx.session.user.id), eq(member.organizationId, activeOrgId)),
    })
    if (!m) {
      throw new ActionError("FORBIDDEN", "You are not a member of this organization.")
    }
    // Set app.current_org first so the member_role lookup below is RLS-allowed.
    // Set BA role provisionally so the FOR-SELECT policy on member_role passes
    // (member_role's SELECT policy is any-member-of-org; BA role is irrelevant
    // to it but app.current_role still has to be set for downstream RLS reads).
    await tx.execute(sql`SELECT set_config('app.current_org', ${activeOrgId}, true)`)
    await tx.execute(sql`SELECT set_config('app.current_role', ${m.role}, true)`)
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.session.user.id}, true)`)

    // Resolve the extended 8-role for the assignment-scoped RLS overlay on
    // contacts/projects/tasks + the financial-role gate on payment tables.
    // Fall back to the BA→extended mapping if member_role hasn't been seeded
    // (the documented Layer 2 in rbac/README.md).
    const extendedRole: ExtendedRole =
      (await lookupExtendedMemberRole(tx, ctx.session.user.id)) ??
      extendedFromBetterAuth(m.role as BetterAuthRole)
    await tx.execute(sql`SELECT set_config('app.current_role', ${extendedRole}, true)`)

    return next({
      ctx: {
        ...ctx,
        db: tx,
        activeOrg: {
          id: activeOrgId,
          role: extendedRole,
          userId: ctx.session.user.id,
        },
      },
    })
  })
})
