"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { and, eq, ne, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { auth } from "@/lib/auth"
import type * as schema from "@/db/schema"
import { log } from "@/lib/log"
import { audit } from "@/modules/audit/audit"
import { invitation, member, user } from "@/modules/auth/schema"
import { invitationExtendedRole, memberRole } from "./schema"
import {
  extendedRoleSchema,
  extendedToBetterAuth,
  invitableExtendedRoleSchema,
  type InvitableExtendedRole,
} from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Push 2c.6.11 commit C — V1 one-email-one-org constraint.
 *
 * Architecture decision (Mike's V4 spec): one email can belong to
 * at most one organization. Enforced at invitation-creation time.
 * Two rejection cases:
 *
 *   1. Email already maps to a `user` row that has a `member` row
 *      in a DIFFERENT org. (Same-org membership doesn't reach this
 *      path — admins can't re-invite a current member; the UI
 *      shows them in the members list.)
 *   2. Email has a pending, non-expired `invitation` row in a
 *      DIFFERENT org. (Same-org pending invitations are valid and
 *      handled by Push 2c.6.10's Cancel / Resend / Reset UX.)
 *
 * Case-insensitive email match. The error message points the
 * inviter toward the future account-linking work (V2) without
 * implying it ships soon.
 *
 * Account-linking (one email → multiple orgs with switcher) is
 * deferred. When it lands, this guard relaxes accordingly. Until
 * then, the constraint prevents Mike from accidentally creating
 * multi-org-per-email state that V1's sign-in flow doesn't know
 * how to handle (single-org auto-pick).
 */
async function assertOneEmailOneOrg(
  tx: DbHandle,
  email: string,
  currentOrgId: string,
): Promise<void> {
  const emailLower = email.toLowerCase().trim()

  // Case 1 — existing user (any verification state) who's already a
  // member of a different org.
  const [existingUser] = await tx
    .select({ id: user.id })
    .from(user)
    .where(sql`LOWER(${user.email}) = ${emailLower}`)
    .limit(1)
  if (existingUser) {
    const [otherOrgMembership] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, existingUser.id), ne(member.organizationId, currentOrgId)))
      .limit(1)
    if (otherOrgMembership) {
      throw new ActionError(
        "CONFLICT",
        `${email} is already part of another organization. They'll need to use a different email to join, or link their existing account (account linking is coming soon).`,
      )
    }
  }

  // Case 2 — pending invitation to a different org.
  const [otherOrgInvite] = await tx
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        sql`LOWER(${invitation.email}) = ${emailLower}`,
        eq(invitation.status, "pending"),
        sql`${invitation.expiresAt} > NOW()`,
        ne(invitation.organizationId, currentOrgId),
      ),
    )
    .limit(1)
  if (otherOrgInvite) {
    throw new ActionError(
      "CONFLICT",
      `${email} already has a pending invitation to another organization. They'll need to use a different email to join, or wait for the other invitation to expire.`,
    )
  }
}

/**
 * Push 2c.6.10 — core invite-create logic extracted from
 * inviteMemberWithExtendedRole so the new resetInvitation action
 * (which re-issues a fresh invitation after canceling an old one)
 * can re-use the exact same BA-call + metadata-insert + compensation
 * flow without duplicating ~40 lines.
 *
 * Caller is responsible for the RBAC gate (admin/owner check) before
 * invoking. orgAction's tx is passed as `tx`; both `auth.api`
 * round-trips run OUTSIDE that tx (BA owns its own connection) and
 * are compensated by cancelInvitation if the metadata insert fails.
 *
 * Push 2c.6.11 commit C — enforces the one-email-one-org constraint
 * before calling BA. See assertOneEmailOneOrg above.
 */
export async function createInviteWithExtendedRoleCore(
  tx: DbHandle,
  reqHeaders: Headers,
  args: {
    organizationId: string
    createdBy: string
    email: string
    extendedRole: InvitableExtendedRole
  },
): Promise<{ invitationId: string }> {
  // Push 2c.6.11 commit C — refuse cross-org membership/invitation
  // before the BA call. If this throws, BA never sees the invite,
  // so there's no compensation to perform.
  await assertOneEmailOneOrg(tx, args.email, args.organizationId)

  const baRole = extendedToBetterAuth(args.extendedRole)
  let invitationId: string
  try {
    const inv = (await auth.api.createInvitation({
      body: {
        email: args.email,
        role: baRole,
        organizationId: args.organizationId,
        resend: true,
      },
      headers: reqHeaders,
    })) as { id: string }
    invitationId = inv.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not send invitation"
    throw new ActionError("VALIDATION", msg)
  }
  try {
    await tx
      .insert(invitationExtendedRole)
      .values({
        invitationId,
        organizationId: args.organizationId,
        extendedRole: args.extendedRole,
        createdBy: args.createdBy,
      })
      .onConflictDoUpdate({
        target: invitationExtendedRole.invitationId,
        set: {
          extendedRole: args.extendedRole,
          createdBy: args.createdBy,
        },
      })
  } catch (insertErr) {
    try {
      await auth.api.cancelInvitation({
        body: { invitationId },
        headers: reqHeaders,
      })
    } catch (cancelErr) {
      log.error(
        {
          invitationId,
          insertErr: insertErr instanceof Error ? { message: insertErr.message } : insertErr,
          cancelErr: cancelErr instanceof Error ? { message: cancelErr.message } : cancelErr,
        },
        "createInviteWithExtendedRoleCore: compensation cancelInvitation failed",
      )
    }
    throw insertErr
  }
  return { invitationId }
}

/**
 * Push 2c.5 — set a member's extended role. Writes to the dedicated
 * `member_role` table (separate from Better Auth's `member.role`,
 * which only knows owner/admin/member). The app-level RBAC layer
 * (rbac/queries.ts:hasPermission) reads from this table.
 *
 * Better Auth's member.role stays untouched: app-level RBAC and
 * auth-level role checks are intentionally decoupled (see
 * rbac/README.md for the rationale). A "manager" or "accountant"
 * appears as a BA "member" at the auth layer; the app reads
 * memberRole.role to gate finer permissions.
 *
 * Permission to change roles is gated by orgAction's RBAC middleware
 * + the surface that calls this action (the MembersList only
 * renders the picker when the current user is owner/admin).
 */
export const setMemberExtendedRole = orgAction
  .metadata({ actionName: "rbac.set_member_extended_role" })
  .inputSchema(
    z.object({
      memberId: z.string().min(1),
      role: extendedRoleSchema,
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    // Look up the target user's userId from the BA member row.
    const [m] = await ctx.db
      .select({ userId: member.userId, organizationId: member.organizationId })
      .from(member)
      .where(eq(member.id, parsedInput.memberId))
      .limit(1)
    if (!m) throw new ActionError("NOT_FOUND", "Member not found")
    if (m.organizationId !== ctx.activeOrg.id) {
      throw new ActionError("FORBIDDEN", "Member does not belong to this organization")
    }
    // Upsert: one role per (orgId, userId) per the unique index.
    await ctx.db
      .insert(memberRole)
      .values({
        id: createId(),
        organizationId: ctx.activeOrg.id,
        userId: m.userId,
        role: parsedInput.role,
      })
      .onConflictDoUpdate({
        target: [memberRole.organizationId, memberRole.userId],
        set: { role: parsedInput.role, updatedAt: new Date() },
      })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "member_role.updated",
      {
        resourceType: "member",
        resourceId: parsedInput.memberId,
        metadata: { userId: m.userId, role: parsedInput.role },
      },
    )
    revalidatePath("/settings/organization/members")
    return { ok: true as const }
  })

/**
 * Push 2c.6.4 — invite a new member with an explicit extended role.
 *
 * Better Auth's invitation row only carries the 3 BA roles (owner /
 * admin / member). When the inviter picks "Manager", "Accountant", or
 * the bare "User" tier, we send the BA invite with the BA-mapped role
 * (extendedToBetterAuth: admin→admin; everything else→member) AND
 * persist the actual extended role to `invitation_extended_role`.
 *
 * On accept, `seedNewMember` looks up the metadata row by invitation
 * id and seeds member_role with the stored extended role (see
 * src/lib/seed-new-member.ts).
 *
 * Atomicity: BA's invitation INSERT happens outside our orgAction
 * transaction (BA owns its own DB connection). If the metadata
 * insert fails inside our tx, the tx rolls back AND we compensate
 * by calling auth.api.cancelInvitation. Best-effort: if the cancel
 * call also fails, the BA invitation is orphaned, but the next
 * accept-flow will fall back to extendedFromBetterAuth (so the
 * invitee still gets a working role — just not the one the inviter
 * intended, which surfaces as a fix-it-up moment in the role picker).
 */
export const inviteMemberWithExtendedRole = orgAction
  .metadata({ actionName: "rbac.invite_member_with_extended_role" })
  .inputSchema(
    z.object({
      email: z.email().max(320),
      extendedRole: invitableExtendedRoleSchema,
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.activeOrg.role !== "owner" && ctx.activeOrg.role !== "admin") {
      throw new ActionError("FORBIDDEN", "Only owners and admins can invite members.")
    }
    const reqHeaders = await headers()
    const { invitationId } = await createInviteWithExtendedRoleCore(ctx.db, reqHeaders, {
      organizationId: ctx.activeOrg.id,
      createdBy: ctx.session.user.id,
      email: parsedInput.email,
      extendedRole: parsedInput.extendedRole,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "invitation.created_with_extended_role",
      {
        resourceType: "invitation",
        resourceId: invitationId,
        metadata: {
          email: parsedInput.email,
          extendedRole: parsedInput.extendedRole,
          baRole: extendedToBetterAuth(parsedInput.extendedRole),
        },
      },
    )
    revalidatePath("/settings/organization/members")
    return { invitationId, extendedRole: parsedInput.extendedRole }
  })

// Defensive use-of-and so eslint doesn't flag the import as unused if
// future variants of this action don't compose the and() helper.
export const _and = and
