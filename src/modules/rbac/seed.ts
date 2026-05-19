import { createId } from "@paralleldrive/cuid2"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { memberRole } from "./schema"
import type { ExtendedRole } from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Bootstrap-trust pattern (READ THIS FIRST): the RLS write-gate on
 * `member_role` requires `app.current_role` IN `('owner', 'admin')`.
 * When this is called from a Better Auth org hook, the user may not
 * yet have any role row at all — so the caller MUST assert
 * `app.current_role='owner'` (or `'admin'`) on the transaction before
 * invoking. That assertion is safe because:
 *
 *   1. The caller is server-side trusted code (a Better Auth hook
 *      OR the dev seed script).
 *   2. Better Auth has already authenticated the user and committed
 *      the corresponding `organization`/`member` row, so the user
 *      IS who they claim and IS in the org.
 *   3. For org-create: the user is, by definition, the owner.
 *      For invite-accept: BA has already verified the invitation.
 *
 * NOT safe to call from user-controlled code paths that don't
 * reliably bootstrap-trust the caller (e.g., never wire this behind
 * a route handler or a server action that anyone can hit).
 *
 * Idempotent via the (organization_id, user_id) unique index — re-runs
 * are no-ops.
 */
export async function seedExtendedMemberRole(
  db: DbHandle,
  orgId: string,
  userId: string,
  role: ExtendedRole,
) {
  await db
    .insert(memberRole)
    .values({
      id: createId(),
      organizationId: orgId,
      userId,
      role,
    })
    .onConflictDoNothing({ target: [memberRole.organizationId, memberRole.userId] })
}

/** Thin wrapper for the org-create hook caller (`role` = "owner"). */
export async function seedMemberRoleForOrgOwner(db: DbHandle, orgId: string, userId: string) {
  return seedExtendedMemberRole(db, orgId, userId, "owner")
}
