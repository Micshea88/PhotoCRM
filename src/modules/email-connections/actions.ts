"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { env } from "@/lib/env"
import { signState } from "@/lib/oauth-pkce"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { buildNylasAuthUrl, NylasNotConfigured } from "./nylas-oauth"
import { emailConnections } from "./schema"
import { beginEmailConnectInput, disconnectEmailInput } from "./types"

/**
 * Email-connection server actions — connect initiation + disconnect.
 *
 * PER-PHOTOGRAPHER: each user connects their OWN mailbox, so there is NO
 * owner/admin gate (unlike telephony, which binds a shared studio account).
 * Any org member connects their own email.
 *
 * CSRF: a userId-bound HMAC `state` (BETTER_AUTH_SECRET) is set as a path-scoped,
 * httpOnly, sameSite=lax cookie carried back to the callback. No PKCE — Nylas's
 * token exchange authenticates with the application API key (client_secret)
 * server-side, which never crosses the boundary.
 */

const COOKIE_PATH = "/api/integrations/nylas"
const STATE_COOKIE = "nylas_oauth_state"
const COOKIE_MAX_AGE_SECONDS = 600

export const beginEmailConnect = orgAction
  .metadata({ actionName: "email_connections.begin_connect" })
  .inputSchema(beginEmailConnectInput)
  .action(async ({ parsedInput, ctx }) => {
    const state = signState(ctx.session.user.id)

    let authorizeUrl: string
    try {
      authorizeUrl = buildNylasAuthUrl({ state, choice: parsedInput.provider })
    } catch (e) {
      if (e instanceof NylasNotConfigured) {
        throw new ActionError(
          "VALIDATION",
          "Email connection is not configured for this workspace.",
        )
      }
      throw e
    }

    const cookieStore = await cookies()
    cookieStore.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.NODE_ENV !== "development",
      sameSite: "lax",
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE_SECONDS,
    })

    return { authorizeUrl }
  })

export const disconnectEmail = orgAction
  .metadata({ actionName: "email_connections.disconnect" })
  .inputSchema(disconnectEmailInput)
  .action(async ({ ctx }) => {
    const orgId = ctx.activeOrg.id
    const userId = ctx.session.user.id
    const result = await ctx.db
      .update(emailConnections)
      .set({ deletedAt: new Date(), deletedBy: userId, updatedBy: userId })
      .where(
        and(
          eq(emailConnections.organizationId, orgId),
          eq(emailConnections.userId, userId),
          isNull(emailConnections.deletedAt),
        ),
      )
      .returning({ id: emailConnections.id })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "No connected email to disconnect.")
    }
    await audit(
      {
        db: ctx.db,
        organizationId: orgId,
        actorUserId: userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "email_connections.disconnected",
      { resourceType: "email_connection", resourceId: result[0]?.id ?? "" },
    )
    revalidatePath("/settings/integrations/email")
    return { ok: true }
  })
