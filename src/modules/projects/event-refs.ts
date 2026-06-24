import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { ActionError } from "@/lib/safe-action"
import { projects } from "@/modules/projects/schema"
import { opportunities } from "@/modules/opportunities/schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Validate that an activity's event association (project / opportunity) belongs
 * to the acting org before it's written — prevents a crafted client from
 * tagging a comm with another org's event id. Shared by the activity comm
 * modules (notes / calls / email / meetings) so the check is identical
 * everywhere. Only checks the refs that are actually being set (non-null).
 */
export async function assertEventRefsInOrg(
  db: DbHandle,
  orgId: string,
  refs: { projectId?: string | null; opportunityId?: string | null },
): Promise<void> {
  if (refs.projectId) {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, refs.projectId),
          eq(projects.organizationId, orgId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1)
    if (!row) throw new ActionError("VALIDATION", "Event not found in this organization.")
  }
  if (refs.opportunityId) {
    const [row] = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, refs.opportunityId),
          eq(opportunities.organizationId, orgId),
          isNull(opportunities.deletedAt),
        ),
      )
      .limit(1)
    if (!row) throw new ActionError("VALIDATION", "Opportunity not found in this organization.")
  }
}
