import "server-only"
import { sql } from "drizzle-orm"
import * as Sentry from "@sentry/nextjs"
import { db } from "@/lib/db"
import { log } from "@/lib/log"
import { seedExtendedMemberRole } from "@/modules/rbac/seed"
import type { ExtendedRole } from "@/modules/rbac/types"
import type { BetterAuthRole } from "@/modules/rbac/types"

/**
 * Runs from Better Auth's `organizationHooks.afterAcceptInvitation`.
 * Seeds the extended role for a user who has just accepted an invitation
 * to an org. By the time this fires, BA has already inserted the
 * `member` row, so the user is verifiably a member of the org.
 *
 * Mapping from BA-role to extended role, since invitations carry only
 * BA's three-role enum:
 *
 *   BA admin   → extended "admin"
 *   BA member  → extended "photographer" (productive default; an admin
 *                can promote via the Phase 4 UI when it ships)
 *   BA owner   → extended "admin" (defensive downgrade — only org
 *                creators should ever be extended "owner")
 *
 * Bootstrap-trust: same pattern as seed-new-org. Inside this tx we set
 * app.current_role='admin' so the rbac RLS write-gate passes. Safe
 * because the hook only fires from BA's verified invitation-accept code
 * path; the user could not synthesize this call without already being a
 * verified invitee.
 *
 * Error handling: log + Sentry + swallow. A partial seed leaves the
 * invitee with `hasPermission()` returning false until they're seeded
 * (Phase 4 admin UI can rescue them), but doesn't break the
 * invitation-accept flow.
 */
export async function seedNewMember(
  orgId: string,
  userId: string,
  baRole: BetterAuthRole,
): Promise<void> {
  const extendedRole: ExtendedRole =
    baRole === "admin" || baRole === "owner" ? "admin" : "photographer"
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org', ${orgId}, true)`)
      await tx.execute(sql`SELECT set_config('app.current_role', 'admin', true)`)
      await seedExtendedMemberRole(tx, orgId, userId, extendedRole)
    })
    log.info({ orgId, userId, baRole, extendedRole }, "seedNewMember: complete")
  } catch (err) {
    Sentry.captureException(err)
    log.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        orgId,
        userId,
        baRole,
      },
      "seedNewMember: failed (invitee will see hasPermission()===false until rescued)",
    )
  }
}
