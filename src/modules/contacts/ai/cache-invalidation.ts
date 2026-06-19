import "server-only"
import { and, eq, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { contacts } from "../schema"

/**
 * Mark that a contact had activity, for AI-summary freshness.
 *
 * (Historically this NULLed all 6 ai_* cache fields — "invalidate." As of the
 * AI-summary-freshness change it instead **bumps `last_activity_at = now()`
 * and leaves the cache intact**, so the stale summary stays visible until the
 * contact page's in-place client swap replaces it. The freshness check
 * regenerates when `last_activity_at > ai_generated_at` — see
 * `refreshContactAiSummary`.)
 *
 * Call this from any action that adds / edits / deletes / completes
 * contact-scoped activity (notes, calls, meetings, SMS, email, contact-scoped
 * tasks) OR changes the contact record itself. Runs atomically inside the
 * surrounding orgAction transaction (see `src/lib/safe-action.ts`).
 *
 * NOTE: `last_activity_at` is a BACKEND-ONLY freshness signal — it is never
 * rendered in the UI (don't confuse it with any user-visible "last contacted"
 * field).
 */
export async function touchContactActivity(
  db: NodePgDatabase<typeof schema>,
  orgId: string,
  contactId: string,
): Promise<void> {
  await db
    .update(contacts)
    .set({ lastActivityAt: sql`now()` })
    .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, orgId)))
}

/**
 * Hard-reset the AI cache (NULLs all 6 ai_* fields). Reserved for a **contact
 * merge**: the winner's identity/facts change so fundamentally that the cached
 * summary describes a now-deleted record — a "show stale then swap" is wrong
 * here, so we clear it and let the next view regenerate from scratch. Routine
 * activity uses `touchContactActivity` (bump-don't-null) instead.
 */
export async function bustContactAiCache(
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
