import "server-only"
import { createSafeActionClient, DEFAULT_SERVER_ERROR_MESSAGE } from "next-safe-action"
import { z } from "zod"
import { headers } from "next/headers"
import * as Sentry from "@sentry/nextjs"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { log } from "@/lib/log"
import { member } from "@/modules/auth/schema"
import { lookupExtendedMemberRole, resolvePermissionInTx } from "@/modules/rbac/queries"
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

/**
 * Push 2c.6 — server-side PII redaction. Server-action error messages
 * occasionally contain raw user data ("duplicate name 'Jane Doe'",
 * "email jane@example.com already exists", etc). Vercel function
 * logs are not a privacy-safe destination for that data — redact
 * before logging.
 *
 * Conservative redaction: any token shaped like an email gets masked
 * a***@b.com; anything with 7+ consecutive digits becomes [PHONE].
 * Names are harder to detect generically (a name without surrounding
 * context could just be a column id) — we don't try to mask them
 * automatically. Action handlers that surface name-bearing errors
 * should redact at the source.
 */
function redactPii(input: string): string {
  let out = input
  out = out.replace(/([A-Za-z0-9])[A-Za-z0-9._+-]*@([A-Za-z0-9-]+\.[A-Za-z0-9.-]+)/g, "$1***@$2")
  out = out.replace(/(?:\+?\d[\s().-]?){7,}\d/g, "[PHONE]")
  return out
}

const baseClient = createSafeActionClient({
  defineMetadataSchema() {
    return z.object({
      actionName: z.string(),
    })
  },
  /**
   * Push 2c.6 — surface the real error to the client instead of the
   * generic DEFAULT_SERVER_ERROR_MESSAGE. The previous behavior
   * swallowed the actual cause and made every server-side failure
   * look identical to the user ("Something went wrong while
   * executing the operation."), which made the save-view bug
   * impossible to diagnose from the wire.
   *
   * Contract:
   *   - ActionError instances are app-defined and safe to surface
   *     verbatim — they're already user-friendly.
   *   - Unexpected errors: log the full stack server-side (PII
   *     redacted, see redactPii). In dev, surface the real message
   *     to the client so the developer can see it. In prod,
   *     truncate to 200 chars + "Server error: " prefix so we
   *     don't leak unbounded internals but the user gets enough
   *     to file a useful bug report.
   */
  handleServerError(e, utils) {
    if (e instanceof ActionError) {
      return e.message
    }
    // Unexpected errors — capture + log with redaction.
    Sentry.captureException(e)
    const raw = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack : undefined
    // Push 2c.6.2 — also surface e.cause. Drizzle wraps pg errors as
    // `new Error("Failed query: ...")` with the underlying pg error
    // attached to `.cause` — without unwrapping we lose the actual
    // failure reason (e.g. "invalid input syntax for type jsonb",
    // "null value in column violates not-null constraint", "new row
    // violates row-level security policy"). The 2c.6 part 1
    // instrumentation didn't unwrap, so the 2c.6.1 production
    // failure showed the SQL + param shape but not WHY pg rejected.
    interface WithCause {
      cause?: unknown
    }
    function describeCause(err: unknown): { message: string; stack?: string } | null {
      const c = (err as WithCause | null)?.cause
      if (c === null || c === undefined) return null
      if (c instanceof Error) {
        return { message: c.message, stack: c.stack }
      }
      // For non-Error causes (plain objects, strings, etc), prefer
      // JSON.stringify but fall back to a manual key walk for objects
      // so the lint check on stringification stays satisfied without
      // sacrificing the diagnostic information.
      if (typeof c === "object") {
        try {
          return { message: JSON.stringify(c) }
        } catch {
          return { message: "[unserializable cause]" }
        }
      }
      return { message: typeof c === "string" ? c : `[cause: ${typeof c}]` }
    }
    const cause = describeCause(e)
    log.error(
      {
        actionName: utils.metadata.actionName,
        err: {
          name: e instanceof Error ? e.name : "Unknown",
          message: redactPii(raw),
          stack: stack ? redactPii(stack) : undefined,
          cause: cause
            ? {
                message: redactPii(cause.message),
                stack: cause.stack ? redactPii(cause.stack) : undefined,
              }
            : undefined,
        },
      },
      "safe-action unexpected error",
    )
    // Also console.error for Vercel default log capture (some hosts
    // surface console.* with finer detail than pino in failure mode).
    // eslint-disable-next-line no-console
    console.error(
      `[safe-action ${utils.metadata.actionName}]`,
      redactPii(raw),
      cause ? `\n  cause: ${redactPii(cause.message)}` : "",
      stack ? redactPii(stack) : "",
    )
    if (process.env.NODE_ENV !== "production") {
      return redactPii(raw)
    }
    const truncated = raw.length > 200 ? raw.slice(0, 200) + "…" : raw
    return `Server error: ${redactPii(truncated)}`
  },
})

// The DEFAULT_SERVER_ERROR_MESSAGE constant is intentionally retained
// as an import in case future code needs to identify a fallback case;
// pinning it here so eslint doesn't flag the import as unused.
void DEFAULT_SERVER_ERROR_MESSAGE

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
    // CRITICAL — hotfix 0041: the connection role in prod is
    // BYPASSRLS (Neon's owner). Without this role switch, every
    // org-scoped RLS policy is silently inert and writes against
    // any org succeed regardless of context. SET LOCAL ROLE drops
    // us into the NOBYPASSRLS app_authenticated role for the
    // duration of THIS transaction only — commit/rollback reverts
    // automatically. MUST come FIRST, before the member lookup +
    // any set_config call.
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
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

    // Resolve the visibility-scope flag (override-aware, in this same tx) and
    // publish it to the assignment-scoped RLS via app.current_view_all_events.
    // Writes always carry the precise value; reads via withOrgContext inherit
    // it through ctx.activeOrg.viewAllEvents below (or fall back role-based).
    const viewAllEvents = await resolvePermissionInTx(
      tx,
      ctx.session.user.id,
      extendedRole,
      "view_all_events",
    )
    await tx.execute(
      sql`SELECT set_config('app.current_view_all_events', ${viewAllEvents ? "true" : "false"}, true)`,
    )

    return next({
      ctx: {
        ...ctx,
        db: tx,
        activeOrg: {
          id: activeOrgId,
          role: extendedRole,
          userId: ctx.session.user.id,
          viewAllEvents,
        },
      },
    })
  })
})
