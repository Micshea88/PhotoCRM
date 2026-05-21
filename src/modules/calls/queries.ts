import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { callLog } from "./schema"

/**
 * Calls for one contact, most recent first. Soft-deleted rows excluded.
 * Used by the contact detail page's Activity feed (Calls filter chip)
 * and the future RingCentral sync's dedup check.
 */
export async function listCallsForContact(contactId: string, opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 50
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(callLog)
      .where(and(eq(callLog.contactId, contactId), isNull(callLog.deletedAt)))
      .orderBy(sql`${callLog.startedAt} DESC`)
      .limit(limit)
  })
}

/**
 * Single call by id, scoped to the active org. Used by detail / edit
 * flows.
 */
export async function getCallById(id: string) {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(callLog)
      .where(and(eq(callLog.id, id), isNull(callLog.deletedAt)))
      .limit(1)
    return row ?? null
  })
}
