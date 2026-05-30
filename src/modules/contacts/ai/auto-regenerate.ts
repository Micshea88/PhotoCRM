import "server-only"
import { log } from "@/lib/log"
import { withOrgContext } from "@/lib/org-context"
import { runRegeneratePipeline, type RegeneratePipelineResult } from "./regenerate-pipeline"

/**
 * Push 3 (C6c polish #5 Fix 8) — page-side auto-regen helper.
 *
 * Called from the contact detail server page when the AI cache is
 * null (typical case: just after `createContactNote` / `logCall` ran
 * the polish #5 Fix 8 invalidation, the next render lands here).
 *
 * Behavior:
 *   - Returns the freshly computed cache values + audits the run
 *     (same as the manual Regenerate button).
 *   - On any throw — missing contact, AI provider outage, etc. —
 *     returns `null`. The page falls back to the cached values it
 *     already loaded (also null), and the user gets the AI summary
 *     card's "No summary cached yet — click Regenerate" empty state.
 *     A failed auto-regen never blocks the page render.
 *
 * Caller MUST be inside a `runWithOrgContext` so RLS is correctly
 * scoped — same contract as every other module read called from a
 * route. The function wraps in `withOrgContext` to get the tx
 * handle.
 */
export async function regenerateContactAiIfMissing(
  contactId: string,
  triggerCtx: {
    organizationId: string
    userId: string
    ipAddress: string | null
    userAgent: string | null
  },
): Promise<RegeneratePipelineResult | null> {
  try {
    return await withOrgContext(async (tx) => {
      return runRegeneratePipeline(tx, triggerCtx, contactId)
    })
  } catch (err) {
    // Per the spec the empty-floor branch is the cost gate, and the
    // pipeline itself never throws on AI failures. Anything that DOES
    // throw here (DB error, contact deleted between read and run) is
    // not worth blocking the render for — log it and let the user
    // hit Regenerate manually.
    if (err instanceof Error) {
      log.warn({ contactId, err: err.message }, "[ai-auto-regen] failed")
    }
    return null
  }
}
