import "server-only"
import { createSafeActionClient, DEFAULT_SERVER_ERROR_MESSAGE } from "next-safe-action"
import { z } from "zod"
import { headers } from "next/headers"
import * as Sentry from "@sentry/nextjs"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { log } from "@/lib/log"
import { member } from "@/modules/auth/schema"
import { and, eq } from "drizzle-orm"

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

/** Action requiring an authenticated session AND an active organization. */
export const orgAction = authAction.use(async ({ next, ctx }) => {
  const activeOrgId = ctx.session.session.activeOrganizationId
  if (!activeOrgId) {
    throw new ActionError("NO_ACTIVE_ORG", "Select or create an organization first.")
  }
  const m = await ctx.db.query.member.findFirst({
    where: and(eq(member.userId, ctx.session.user.id), eq(member.organizationId, activeOrgId)),
  })
  if (!m) {
    throw new ActionError("FORBIDDEN", "You are not a member of this organization.")
  }
  return next({
    ctx: {
      ...ctx,
      activeOrg: {
        id: activeOrgId,
        role: m.role as "owner" | "admin" | "member",
      },
    },
  })
})
