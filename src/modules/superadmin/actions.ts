"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { ActionError, authAction } from "@/lib/safe-action"
import { auth } from "@/lib/auth"
import { audit } from "@/modules/audit/audit"
import { withOrgContext } from "@/lib/org-context"
import { getUserOrganizations } from "@/modules/org/queries"
import { session, user } from "@/modules/auth/schema"
import { assertPathwaySuperadmin } from "@/modules/superadmin/access"

/**
 * Pathway-staff cross-tenant account recovery (Piece C).
 *
 * For a fully-locked-out account owner, only Pathway can help. These actions are
 * gated by the `PATHWAY_SUPERADMIN_EMAILS` allowlist and are **credential-only**:
 * they touch ONLY the Better Auth auth tables (user / session / verification) and
 * NEVER read a tenant's business data — so a support action can restore access
 * without ever seeing a studio's data (LAW 4 stays intact). There is deliberately
 * NO impersonation. Every action is audited.
 *
 * Not orgActions: recovery is cross-tenant, so there's no single active org.
 * `authAction` gives the actor's session; the allowlist is the authorization.
 */

const emailInput = z.object({ email: z.email() })

/** Look up a target user by email (BA `user` table — not RLS-scoped). */
async function lookupUser(
  db: NodePgDatabase<typeof schema>,
  email: string,
): Promise<{ id: string; email: string; emailVerified: boolean }> {
  const [row] = await db
    .select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  if (!row) throw new ActionError("NOT_FOUND", "No account with that email.")
  return row
}

/**
 * Record a superadmin recovery in the audit log. `audit_log` is RLS-protected and
 * `organization_id` is NOT NULL, so we anchor the row to the TARGET's org (the
 * affected studio sees the support action in its trail — transparency), falling
 * back to the actor's org if the target is org-less. Written under that org's
 * context via `withOrgContext` so the RLS WITH CHECK passes.
 */
async function auditRecovery(
  actor: { userId: string; ipAddress?: string | null; userAgent?: string | null },
  target: { id: string; email: string },
  action: string,
): Promise<void> {
  const targetOrgs = await getUserOrganizations(target.id)
  let orgId = targetOrgs[0]?.id
  if (!orgId) {
    const actorOrgs = await getUserOrganizations(actor.userId)
    orgId = actorOrgs[0]?.id
  }
  if (!orgId) return // no org anywhere to anchor the row (near-impossible for a real recovery)
  const anchorOrgId = orgId
  await withOrgContext(
    (db) =>
      audit(
        {
          db,
          organizationId: anchorOrgId,
          actorUserId: actor.userId,
          ipAddress: actor.ipAddress ?? null,
          userAgent: actor.userAgent ?? null,
        },
        action,
        { resourceType: "user", resourceId: target.id, metadata: { email: target.email } },
      ),
    { orgId: anchorOrgId, role: "admin", userId: actor.userId },
  )
}

export const superadminSendPasswordReset = authAction
  .metadata({ actionName: "superadmin.password_reset" })
  .inputSchema(emailInput)
  .action(async ({ parsedInput, ctx }) => {
    assertPathwaySuperadmin(ctx.session.user.email)
    const target = await lookupUser(ctx.db, parsedInput.email)
    await auth.api.requestPasswordReset({
      body: { email: target.email, redirectTo: "/reset-password" },
      headers: await headers(),
    })
    await auditRecovery(
      { userId: ctx.session.user.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      target,
      "superadmin.password_reset_sent",
    )
    return { ok: true as const }
  })

export const superadminRevokeSessions = authAction
  .metadata({ actionName: "superadmin.revoke_sessions" })
  .inputSchema(emailInput)
  .action(async ({ parsedInput, ctx }) => {
    assertPathwaySuperadmin(ctx.session.user.email)
    const target = await lookupUser(ctx.db, parsedInput.email)
    await ctx.db.delete(session).where(eq(session.userId, target.id))
    await auditRecovery(
      { userId: ctx.session.user.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      target,
      "superadmin.sessions_revoked",
    )
    return { ok: true as const }
  })

export const superadminResendVerification = authAction
  .metadata({ actionName: "superadmin.resend_verification" })
  .inputSchema(emailInput)
  .action(async ({ parsedInput, ctx }) => {
    assertPathwaySuperadmin(ctx.session.user.email)
    const target = await lookupUser(ctx.db, parsedInput.email)
    if (target.emailVerified) {
      throw new ActionError("CONFLICT", "This account's email is already verified.")
    }
    await auth.api.sendVerificationEmail({
      body: { email: target.email },
      headers: await headers(),
    })
    await auditRecovery(
      { userId: ctx.session.user.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      target,
      "superadmin.verification_resent",
    )
    return { ok: true as const }
  })
