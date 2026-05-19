import { createId } from "@paralleldrive/cuid2"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { memberRole } from "./schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Assign a user as owner of an organization. Idempotent via the
 * (organization_id, user_id) unique index.
 *
 * Bootstrap-trust pattern: the RLS write-gate on `member_role` requires
 * `current_role` to be `owner|admin`. When this is called from the
 * Better Auth `afterCreateOrganization` hook, no row exists yet — there
 * IS no admin yet — so the caller must assert `app.current_role='owner'`
 * before invoking. That assertion is safe because:
 *
 *   1. The caller is server-side trusted code (the auth hook OR the dev
 *      seed script).
 *   2. The org was just created in the same trust boundary.
 *   3. By definition, the user who created the org is the owner.
 *
 * NOT safe to call from user-controlled code paths that don't reliably
 * bootstrap-trust the caller (e.g., never put this behind a route
 * handler).
 */
export async function seedMemberRoleForOrgOwner(db: DbHandle, orgId: string, userId: string) {
  await db
    .insert(memberRole)
    .values({
      id: createId(),
      organizationId: orgId,
      userId,
      role: "owner",
    })
    .onConflictDoNothing({ target: [memberRole.organizationId, memberRole.userId] })
}
