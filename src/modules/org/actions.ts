"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ActionError, authAction } from "@/lib/safe-action"
import { auth } from "@/lib/auth"
import { log } from "@/lib/log"
import { audit } from "@/modules/audit/audit"
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
