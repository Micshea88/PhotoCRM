import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { ActionError } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { telephonyConnections } from "@/modules/telephony/schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Pure helper that mirrors the body of the `disconnectTelephony`
 * server action. Extracted so integration tests can drive the EXACT
 * SQL+audit pattern the action does, with no hand-written copy that
 * could drift.
 *
 * The action (src/modules/telephony/actions.ts) wraps this with:
 *   - owner/admin role gate
 *   - orgAction's auth + RLS role-switch transaction
 *   - revalidatePath after success
 *
 * This helper does only the database mutation + audit log write:
 *   1. UPDATE telephony_connections SET deleted_at=NOW(),
 *      deleted_by=actor WHERE org/user/provider/is-live RETURNING id.
 *   2. If 0 rows matched → ActionError NOT_FOUND (callers translate
 *      to the appropriate response shape; for the action that's a
 *      surfaced ActionError; for tests, a rejects.toThrow assertion).
 *   3. audit("telephony.disconnected", {provider}).
 *
 * MUST run inside a transaction with `app.current_org` set — RLS
 * enforces the org boundary. The caller is responsible for the
 * runWithOrgContext / orgAction transaction setup.
 */
export async function disconnectTelephonyImpl(
  tx: DbHandle,
  args: {
    organizationId: string
    userId: string
    provider: string
    actorUserId: string
    ipAddress?: string | null
    userAgent?: string | null
  },
): Promise<{ id: string }> {
  const result = await tx
    .update(telephonyConnections)
    .set({ deletedAt: new Date(), deletedBy: args.actorUserId })
    .where(
      and(
        eq(telephonyConnections.organizationId, args.organizationId),
        eq(telephonyConnections.userId, args.userId),
        eq(telephonyConnections.provider, args.provider),
        isNull(telephonyConnections.deletedAt),
      ),
    )
    .returning({ id: telephonyConnections.id })

  const [row] = result
  if (!row) {
    throw new ActionError("NOT_FOUND", "No active connection for this provider.")
  }

  await audit(
    {
      db: tx,
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    },
    "telephony.disconnected",
    {
      resourceType: "telephony_connection",
      resourceId: row.id,
      metadata: { provider: args.provider },
    },
  )

  return row
}
