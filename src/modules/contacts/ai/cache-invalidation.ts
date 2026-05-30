import "server-only"
import { and, eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { contacts } from "../schema"

/**
 * Push 3 (C6c polish #5 Fix 8) — AI cache invalidation.
 *
 * Any action that creates or updates contact-scoped activity (notes,
 * calls, meetings, SMS) MUST call this helper after the insert so
 * the next page render sees `aiGeneratedAt = null` and the auto-
 * regen pipeline runs with fresh activity counts. Without this, the
 * 7-day cache TTL holds the stale summary through repeated visits.
 *
 * Runs atomically with the surrounding orgAction transaction (every
 * orgAction body executes inside `ctx.db.transaction(...)` — see
 * `src/lib/safe-action.ts`). If the activity insert succeeds but
 * this UPDATE fails, both roll back — there's no "ghost note with
 * stale cache" state.
 *
 * Wiring requirement: when a NEW activity-creating action ships
 * (meetings, sms, future), the action MUST call this helper at the
 * same place createContactNote / logCall do. See
 * `docs/pathway-ai-architecture.md` "Cache invalidation".
 */
export async function invalidateContactAiCache(
  db: NodePgDatabase<typeof schema>,
  orgId: string,
  contactId: string,
): Promise<void> {
  await db
    .update(contacts)
    .set({
      aiLeadStatus: null,
      aiLeadStatusReasoning: null,
      aiSummaryText: null,
      aiInsightsJson: null,
      aiGeneratedAt: null,
      aiGenerationModel: null,
    })
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, orgId)))
}
