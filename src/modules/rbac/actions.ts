"use server"

import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { z } from "zod"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { member } from "@/modules/auth/schema"
import { memberRole } from "./schema"
import { extendedRoleSchema } from "./types"

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

// Defensive use-of-and so eslint doesn't flag the import as unused if
// future variants of this action don't compose the and() helper.
export const _and = and
