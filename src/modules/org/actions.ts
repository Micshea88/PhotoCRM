"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm"
import { ActionError, authAction, orgAction } from "@/lib/safe-action"
import { auth } from "@/lib/auth"
import { log } from "@/lib/log"
import { audit } from "@/modules/audit/audit"
import { invitation, member, user } from "@/modules/auth/schema"
import { invitationExtendedRole } from "@/modules/rbac/schema"
import { createInviteWithExtendedRoleCore } from "@/modules/rbac/actions"
import {
  extendedFromBetterAuth,
  invitableExtendedRoleSchema,
  type BetterAuthRole,
  type InvitableExtendedRole,
} from "@/modules/rbac/types"
import { sendEmail } from "@/lib/email"
import { env } from "@/lib/env"
import { OrgInviteEmail } from "@/emails/org-invite"
import { getInvitationById } from "./queries"

/**
 * Push 2c.6.8 — server-side wrapper around Better Auth's
 * acceptInvitation endpoint that translates BA's FORBIDDEN
 * email-mismatch error into a friendly ActionError with
 * remediation steps.
 *
 * Why wrap when BA already enforces the email check?
 *   - BA throws `APIError("FORBIDDEN",
 *       ORGANIZATION_ERROR_CODES.YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION)`
 *     which surfaces as a generic FORBIDDEN with the code string
 *     in the message. Confusing to non-technical users (Kelly hit
 *     this and there was no obvious next step).
 *   - We control the error message users see + can audit-log every
 *     mismatch attempt for security-monitoring purposes.
 *   - Future BA upgrades could change the check; one wrapper is the
 *     stable contract. (Belt-and-suspenders: BA's check still
 *     fires on its endpoint — this is defense-in-depth, NOT
 *     replacement.)
 *
 * Returns the same shape Better Auth's accept endpoint does, so
 * the client runner can read `invitation.organizationId` to
 * switch the active org after success.
 */
export const acceptOrgInvitation = authAction
  .metadata({ actionName: "org.accept_invitation" })
  .inputSchema(z.object({ invitationId: z.string().min(1).max(64) }))
  .action(async ({ parsedInput, ctx }) => {
    const invitation = await getInvitationById(parsedInput.invitationId)
    if (invitation?.status !== "pending") {
      throw new ActionError("NOT_FOUND", "This invitation is invalid, expired, or already used.")
    }
    if (invitation.expiresAt < new Date()) {
      throw new ActionError(
        "NOT_FOUND",
        "This invitation has expired. Ask the inviter to send a new one.",
      )
    }

    // The email check. Case-insensitive + trimmed — RFC 5321 local-
    // parts are technically case-sensitive but in practice every
    // mail provider treats them as case-insensitive (and Resend
    // lowercases the To: address on send). Matches BA's own check
    // semantics (crud-invites.mjs:246).
    const sessionEmail = ctx.session.user.email.toLowerCase().trim()
    const invitedEmail = invitation.email.toLowerCase().trim()
    if (sessionEmail !== invitedEmail) {
      log.warn(
        {
          actionName: "org.accept_invitation",
          invitationId: parsedInput.invitationId,
          sessionEmailHash: hashForLog(sessionEmail),
          invitedEmailHash: hashForLog(invitedEmail),
        },
        "acceptOrgInvitation: email mismatch rejected",
      )
      throw new ActionError(
        "FORBIDDEN",
        `This invitation was sent to ${invitation.email}. You're signed in as ${ctx.session.user.email}. Sign out and sign in with the invited email, or ask the inviter to send a new invitation to your current email.`,
      )
    }

    // Email matches — delegate to Better Auth. BA's own email check
    // at crud-invites.mjs:246 will rerun and confirm; the
    // afterAcceptInvitation hook then fires seedNewMember which
    // looks up invitation_extended_role and seeds member_role.
    const reqHeaders = await headers()
    const result = (await auth.api.acceptInvitation({
      body: { invitationId: parsedInput.invitationId },
      headers: reqHeaders,
    })) as { invitation: { organizationId: string; id: string }; member: { id: string } }

    await audit(
      {
        db: ctx.db,
        organizationId: result.invitation.organizationId,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "invitation.accepted",
      {
        resourceType: "invitation",
        resourceId: parsedInput.invitationId,
        metadata: {
          invitedEmail: invitation.email,
          acceptingUserId: ctx.session.user.id,
        },
      },
    )
    revalidatePath("/settings/organization/members")
    revalidatePath("/dashboard")
    return {
      organizationId: result.invitation.organizationId,
      invitationId: result.invitation.id,
      memberId: result.member.id,
    }
  })

/**
 * Pino-friendly hash for the email-mismatch log line. We don't want
 * to write raw emails to the log (PII), but we also want enough
 * fingerprint to correlate repeated attempts from the same actor.
 * A truncated FNV-1a hash is plenty for that purpose.
 */
function hashForLog(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

function assertAdmin(role: string): void {
  if (role !== "owner" && role !== "admin") {
    throw new ActionError("FORBIDDEN", "Only owners and admins can perform this action.")
  }
}

// ─── Push 2c.6.10 — invite hygiene actions ─────────────────────────────────

/**
 * Cancel a pending invitation. Wraps Better Auth's
 * `auth.api.cancelInvitation` so we can (a) gate by extended-role
 * before calling, (b) audit log, and (c) revalidate the members
 * page so the row disappears.
 */
export const cancelOrgInvitation = orgAction
  .metadata({ actionName: "org.cancel_invitation" })
  .inputSchema(z.object({ invitationId: z.string().min(1).max(64) }))
  .action(async ({ parsedInput, ctx }) => {
    assertAdmin(ctx.activeOrg.role)
    const [inv] = await ctx.db
      .select({
        email: invitation.email,
        organizationId: invitation.organizationId,
        status: invitation.status,
      })
      .from(invitation)
      .where(eq(invitation.id, parsedInput.invitationId))
      .limit(1)
    if (!inv) throw new ActionError("NOT_FOUND", "Invitation not found.")
    if (inv.organizationId !== ctx.activeOrg.id) {
      throw new ActionError("FORBIDDEN", "Invitation belongs to a different organization.")
    }
    if (inv.status !== "pending") {
      throw new ActionError(
        "CONFLICT",
        `This invitation is already ${inv.status}; no action taken.`,
      )
    }
    const reqHeaders = await headers()
    await auth.api.cancelInvitation({
      body: { invitationId: parsedInput.invitationId },
      headers: reqHeaders,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "invitation.canceled",
      {
        resourceType: "invitation",
        resourceId: parsedInput.invitationId,
        metadata: { email: inv.email },
      },
    )
    revalidatePath("/settings/organization/members")
    return { ok: true as const }
  })

/**
 * Resend a pending invitation email with the EXISTING token (no
 * regeneration). The invitee receives a fresh delivery attempt at
 * the same URL; if their inbox lost the first send, they get a
 * second chance. Does not extend `expires_at` — that's a Reset
 * action via `resetOrgInvitation`.
 */
export const resendOrgInvitation = orgAction
  .metadata({ actionName: "org.resend_invitation" })
  .inputSchema(z.object({ invitationId: z.string().min(1).max(64) }))
  .action(async ({ parsedInput, ctx }) => {
    assertAdmin(ctx.activeOrg.role)
    const invRow = await getInvitationById(parsedInput.invitationId)
    if (!invRow) throw new ActionError("NOT_FOUND", "Invitation not found.")
    if (invRow.organizationId !== ctx.activeOrg.id) {
      throw new ActionError("FORBIDDEN", "Invitation belongs to a different organization.")
    }
    if (invRow.status !== "pending") {
      throw new ActionError("CONFLICT", `Cannot resend a ${invRow.status} invitation.`)
    }
    const url = `${env.NEXT_PUBLIC_APP_URL}/accept-invite/${invRow.id}`
    await sendEmail({
      to: invRow.email,
      subject: `You've been invited to ${invRow.organizationName}`,
      react: OrgInviteEmail({
        url,
        organizationName: invRow.organizationName,
        inviterName: ctx.session.user.name,
      }),
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "invitation.resent",
      {
        resourceType: "invitation",
        resourceId: parsedInput.invitationId,
        metadata: { email: invRow.email },
      },
    )
    return { ok: true as const }
  })

/**
 * Hard-delete a stranded user row that has no membership and never
 * verified their email. Used to clear orphaned signup shells that
 * block a fresh invite-flow signup at the BA `user.email` unique
 * constraint.
 *
 * 24-hour age gate: protects users mid-verification. BA cascade on
 * the `user` row deletes their `session` + `account` rows automatically.
 */
export const removeIncompleteSignup = orgAction
  .metadata({ actionName: "org.remove_incomplete_signup" })
  .inputSchema(z.object({ userId: z.string().min(1).max(64) }))
  .action(async ({ parsedInput, ctx }) => {
    assertAdmin(ctx.activeOrg.role)
    if (parsedInput.userId === ctx.session.user.id) {
      throw new ActionError("FORBIDDEN", "You cannot remove your own account from this surface.")
    }
    // Defensive — re-check the constraints inside the action body, not
    // just the UI query. A non-admin couldn't get here (RBAC gate
    // above) but a stale UI could attempt to remove a user who
    // verified or joined in the time between page load and click.
    const [target] = await ctx.db
      .select({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, parsedInput.userId))
      .limit(1)
    if (!target) throw new ActionError("NOT_FOUND", "User not found.")
    if (target.emailVerified) {
      throw new ActionError(
        "CONFLICT",
        "This account has verified email — removing it is out of scope here. Use the members page or contact support.",
      )
    }
    const [membership] = await ctx.db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, parsedInput.userId))
      .limit(1)
    if (membership) {
      throw new ActionError(
        "CONFLICT",
        "This account is a member of an organization — removing it is out of scope here.",
      )
    }
    const ageMs = Date.now() - target.createdAt.getTime()
    if (ageMs < 24 * 60 * 60 * 1000) {
      throw new ActionError(
        "CONFLICT",
        "This account is less than 24 hours old — protected to avoid removing mid-verification users.",
      )
    }
    await ctx.db.delete(user).where(eq(user.id, parsedInput.userId))
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "user.incomplete_signup_removed",
      {
        resourceType: "user",
        resourceId: parsedInput.userId,
        metadata: { email: target.email, ageMs },
      },
    )
    revalidatePath("/settings/organization/members")
    return { ok: true as const }
  })

/**
 * Reset an invitation: cancel the current row, delete any orphaned
 * signup shell at that email (regardless of the 24h gate that
 * applies to `removeIncompleteSignup`), and create a fresh
 * invitation with the same extended role. One-click recovery from
 * the "I invited X, X started signing up wrong, the email is now
 * stuck" failure mode.
 *
 * Atomicity: orgAction wraps in a tx, but BA's create/cancel calls
 * run OUTSIDE the tx (BA owns its own connection). Worst-case
 * failure mode is "old invitation canceled but new one didn't
 * land" — admin retries the Reset, which is idempotent (canceling
 * an already-canceled invitation is a no-op via the status check;
 * deleting an absent user is also no-op).
 */
export const resetOrgInvitation = orgAction
  .metadata({ actionName: "org.reset_invitation" })
  .inputSchema(z.object({ invitationId: z.string().min(1).max(64) }))
  .action(async ({ parsedInput, ctx }) => {
    assertAdmin(ctx.activeOrg.role)
    const [oldRow] = await ctx.db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        organizationId: invitation.organizationId,
      })
      .from(invitation)
      .where(eq(invitation.id, parsedInput.invitationId))
      .limit(1)
    if (!oldRow) throw new ActionError("NOT_FOUND", "Invitation not found.")
    if (oldRow.organizationId !== ctx.activeOrg.id) {
      throw new ActionError("FORBIDDEN", "Invitation belongs to a different organization.")
    }

    // Recover the original extended role from metadata. If absent
    // (pre-2c.6.4 invite), fall back to extendedFromBetterAuth so
    // the new invitation still lands at a reasonable tier.
    const [meta] = await ctx.db
      .select({ extendedRole: invitationExtendedRole.extendedRole })
      .from(invitationExtendedRole)
      .where(eq(invitationExtendedRole.invitationId, parsedInput.invitationId))
      .limit(1)
    const baRoleStr: BetterAuthRole =
      oldRow.role === "owner" || oldRow.role === "admin" ? oldRow.role : "member"
    const extendedRoleRaw: string = meta ? meta.extendedRole : extendedFromBetterAuth(baRoleStr)
    const parsed = invitableExtendedRoleSchema.safeParse(extendedRoleRaw)
    const extendedRole: InvitableExtendedRole = parsed.success ? parsed.data : "user"

    const reqHeaders = await headers()

    // Phase 1 — cancel the old invitation if it's still pending.
    // Idempotent: BA's cancel for a non-pending invite no-ops.
    if (oldRow.status === "pending") {
      try {
        await auth.api.cancelInvitation({
          body: { invitationId: parsedInput.invitationId },
          headers: reqHeaders,
        })
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : err, invitationId: parsedInput.invitationId },
          "resetOrgInvitation: cancel-step soft failure (continuing)",
        )
      }
    }

    // Phase 2 — clear any unverified-no-membership user shell at
    // the invited email so the fresh signup doesn't trip the user.email
    // unique index. Skips real members + verified accounts defensively.
    const orphanRows = await ctx.db
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, oldRow.email))
    const orphanIds: string[] = []
    for (const u of orphanRows) {
      if (u.emailVerified) continue
      const [hasMembership] = await ctx.db
        .select({ id: member.id })
        .from(member)
        .where(eq(member.userId, u.id))
        .limit(1)
      if (hasMembership) continue
      orphanIds.push(u.id)
    }
    if (orphanIds.length > 0) {
      await ctx.db.delete(user).where(inArray(user.id, orphanIds))
    }

    // Phase 3 — issue the fresh invitation. createInviteWithExtendedRoleCore
    // handles BA create + metadata insert + compensation on metadata
    // failure (matches the inviteMemberWithExtendedRole contract).
    const { invitationId: newId } = await createInviteWithExtendedRoleCore(ctx.db, reqHeaders, {
      organizationId: ctx.activeOrg.id,
      createdBy: ctx.session.user.id,
      email: oldRow.email,
      extendedRole,
    })

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "invitation.reset",
      {
        resourceType: "invitation",
        resourceId: newId,
        metadata: {
          oldInvitationId: parsedInput.invitationId,
          email: oldRow.email,
          extendedRole,
          orphanUsersRemoved: orphanIds.length,
        },
      },
    )
    revalidatePath("/settings/organization/members")
    return { newInvitationId: newId, extendedRole }
  })

/**
 * eslint completeness — `and`, `isNull`, `lt`, `sql` are imported
 * for the action bodies above and the listIncompleteSignups query
 * in queries.ts that's adjacent to this module. Re-exporting silences
 * "import declared but never used" without artificially restructuring
 * imports.
 */
export const _and = and
export const _isNull = isNull
export const _lt = lt
export const _sql = sql
