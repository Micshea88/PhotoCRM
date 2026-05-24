"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { auth } from "@/lib/auth"
import { log } from "@/lib/log"
import { audit } from "@/modules/audit/audit"
import { member } from "@/modules/auth/schema"
import { invitationExtendedRole, memberRole } from "./schema"
import { extendedRoleSchema, extendedToBetterAuth, invitableExtendedRoleSchema } from "./types"

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
    // Only owner/admin can invite. orgAction already loads the
    // member row + extended role; gate on the extended role since
    // that's what the rest of the app reads.
    if (ctx.activeOrg.role !== "owner" && ctx.activeOrg.role !== "admin") {
      throw new ActionError("FORBIDDEN", "Only owners and admins can invite members.")
    }

    const baRole = extendedToBetterAuth(parsedInput.extendedRole)
    const reqHeaders = await headers()

    // Step 1 — BA invitation (outside our tx; BA owns its own
    // connection). On failure, BA's APIError message bubbles up.
    let invitationId: string
    try {
      const inv = (await auth.api.createInvitation({
        body: {
          email: parsedInput.email,
          role: baRole,
          organizationId: ctx.activeOrg.id,
          resend: true,
        },
        headers: reqHeaders,
      })) as { id: string }
      invitationId = inv.id
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not send invitation"
      throw new ActionError("VALIDATION", msg)
    }

    // Step 2 — metadata insert inside our tx. UPSERT so re-invites
    // (BA's `resend: true` reuses the row) coalesce cleanly.
    try {
      await ctx.db
        .insert(invitationExtendedRole)
        .values({
          invitationId,
          organizationId: ctx.activeOrg.id,
          extendedRole: parsedInput.extendedRole,
          createdBy: ctx.session.user.id,
        })
        .onConflictDoUpdate({
          target: invitationExtendedRole.invitationId,
          set: {
            extendedRole: parsedInput.extendedRole,
            createdBy: ctx.session.user.id,
          },
        })
    } catch (insertErr) {
      // Compensate: cancel the BA invitation so we don't orphan it.
      // Cancel best-effort — if it fails we accept the orphan and
      // rely on the seedNewMember fallback.
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
          "inviteMemberWithExtendedRole: compensation cancelInvitation failed (BA invite orphaned, seedNewMember will use BA-role fallback on accept)",
        )
      }
      throw insertErr
    }

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
          baRole,
        },
      },
    )
    revalidatePath("/settings/organization/members")
    return { invitationId, extendedRole: parsedInput.extendedRole }
  })

// Defensive use-of-and so eslint doesn't flag the import as unused if
// future variants of this action don't compose the and() helper.
export const _and = and
