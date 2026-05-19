import "server-only"
import { sql } from "drizzle-orm"
import * as Sentry from "@sentry/nextjs"
import { db } from "@/lib/db"
import { log } from "@/lib/log"
import { seedTerminologyForOrg } from "@/modules/terminology/seed"
import { seedMemberRoleForOrgOwner } from "@/modules/rbac/seed"
import { seedDefaultPipelines } from "@/modules/pipelines/seed"

/**
 * Runs once per newly-created organization, from Better Auth's
 * `organizationHooks.afterCreateOrganization`. Seeds two cross-module
 * configurations into the new org:
 *
 *   1. `terminology_map` — the V1 photographer pack so labels render
 *      correctly (project → "Event"/"Events", etc.) without the
 *      capitalized-key fallback.
 *   2. `member_role` — assigns the org creator as `owner` in the
 *      extended 8-role table, matching the `member.role = "owner"` that
 *      Better Auth has just written to its own member table.
 *
 * Bootstrap-trust: this code runs in a Postgres transaction with
 * app.current_org set to the new org and app.current_role set to "owner".
 * The RLS write-gate on `member_role` requires owner/admin role; here we
 * assert "owner" because Better Auth's hook only fires after the org's
 * creator has been minted as the owner. See src/modules/rbac/seed.ts for
 * the full safety rationale.
 *
 * Error handling: failures are logged + sent to Sentry and SWALLOWED so a
 * partial-seed failure doesn't fail the org-create flow. The user lands
 * in a degraded org (labels fall back; rbac falls back to Better Auth's
 * three-role) rather than a wedge. The first-seen seeding error in
 * Sentry is the trigger to investigate and run a backfill.
 */
export async function seedNewOrganization(orgId: string, creatorUserId: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org', ${orgId}, true)`)
      await tx.execute(sql`SELECT set_config('app.current_role', 'owner', true)`)
      await seedTerminologyForOrg(tx, orgId)
      await seedMemberRoleForOrgOwner(tx, orgId, creatorUserId)
      await seedDefaultPipelines(tx, orgId)
    })
    log.info({ orgId, creatorUserId }, "seedNewOrganization: complete")
  } catch (err) {
    Sentry.captureException(err)
    log.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        orgId,
        creatorUserId,
      },
      "seedNewOrganization: failed (partial-seed; org is functional with fallbacks)",
    )
    // Intentionally do not rethrow.
  }
}
