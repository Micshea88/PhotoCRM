import "server-only"
import { and, eq, sql } from "drizzle-orm"
import * as Sentry from "@sentry/nextjs"
import { db } from "@/lib/db"
import { log } from "@/lib/log"
import { invitationExtendedRole } from "@/modules/rbac/schema"
import { seedExtendedMemberRole } from "@/modules/rbac/seed"
import {
  EXTENDED_ROLES,
  extendedFromBetterAuth,
  type ExtendedRole,
  type BetterAuthRole,
} from "@/modules/rbac/types"

/**
 * Runs from Better Auth's `organizationHooks.afterAcceptInvitation`.
 * Seeds the extended role for a user who has just accepted an invitation
 * to an org. By the time this fires, BA has already inserted the
 * `member` row, so the user is verifiably a member of the org.
 *
 * Resolution priority for the extended role:
 *
 *   1. Push 2c.6.4 — invitation_extended_role row keyed by the
 *      invitation id. Persists the inviter's "Manager / Accountant /
 *      etc." pick across the round-trip between send-invite and
 *      accept-invite. Wins when present.
 *
 *   2. Fallback — extendedFromBetterAuth(baRole): BA admin/owner →
 *      "admin", BA member → "user". Applies when:
 *        - The invitation was sent before 2c.6.4 (no metadata row
 *          ever existed for it), or
 *        - inviteMemberWithExtendedRole's compensation cleanup ran
 *          (orphan + no metadata).
 *
 * Bootstrap-trust: same pattern as seed-new-org. Inside this tx we set
 * app.current_role='admin' so both the metadata SELECT (org-isolation
 * RLS) and the seedExtendedMemberRole write (admin/owner-only RLS)
 * pass. Safe because the hook only fires from BA's verified
 * invitation-accept code path; the user could not synthesize this
 * call without already being a verified invitee.
 *
 * Error handling: log + Sentry + swallow. A partial seed leaves the
 * invitee with `hasPermission()` returning false until they're seeded
 * (the role picker in members-list.tsx is the manual rescue path), but
 * doesn't break the invitation-accept flow.
 */
export async function seedNewMember(
  orgId: string,
  userId: string,
  baRole: BetterAuthRole,
  invitationId?: string,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org', ${orgId}, true)`)
      await tx.execute(sql`SELECT set_config('app.current_role', 'admin', true)`)

      // Resolve the extended role: metadata row wins, else BA fallback.
      let extendedRole: ExtendedRole = extendedFromBetterAuth(baRole)
      let resolvedFromMetadata = false
      if (invitationId) {
        const [metadataRow] = await tx
          .select({ extendedRole: invitationExtendedRole.extendedRole })
          .from(invitationExtendedRole)
          .where(
            and(
              eq(invitationExtendedRole.invitationId, invitationId),
              eq(invitationExtendedRole.organizationId, orgId),
            ),
          )
          .limit(1)
        if (metadataRow && isExtendedRole(metadataRow.extendedRole)) {
          extendedRole = metadataRow.extendedRole
          resolvedFromMetadata = true
        }
      }

      await seedExtendedMemberRole(tx, orgId, userId, extendedRole)

      // Metadata row is cleaned up by the invitation row's CASCADE
      // delete (BA marks the invitation as accepted then removes
      // it; the FK fires). No explicit delete needed.
      log.info(
        { orgId, userId, baRole, extendedRole, resolvedFromMetadata, invitationId },
        "seedNewMember: complete",
      )
    })
  } catch (err) {
    Sentry.captureException(err)
    log.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        orgId,
        userId,
        baRole,
        invitationId,
      },
      "seedNewMember: failed (invitee will see hasPermission()===false until rescued)",
    )
  }
}

function isExtendedRole(v: string): v is ExtendedRole {
  return (EXTENDED_ROLES as readonly string[]).includes(v)
}
