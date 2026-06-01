"use server"

import { z } from "zod"
import { orgAction } from "@/lib/safe-action"
import { callAiModel } from "@/lib/ai-model"
import { listFieldDefinitionsForRecordTypeWithDb } from "@/modules/custom-fields/queries"
import { HAIKU_MODEL } from "@/modules/contacts/ai/lead-status-classifier"
import { recordAiUsage } from "@/modules/contacts/ai/usage-tracker"
import {
  buildAllowedTargets,
  buildSystemPrompt,
  buildUserPrompt,
  parseColumnScanResponse,
  type ColumnScanSuggestion,
  type CustomFieldDefForScan,
} from "./import-ai-parser"

/**
 * CSV Import V2 — AI column scanner.
 *
 * Sends the user's CSV headers + a few sample rows to Haiku and asks
 * for a best-target suggestion per column. Suggestions pre-fill the
 * Map step's dropdowns; users always remain free to override.
 *
 * Hard contract (NON-NEGOTIABLE — Mike's spec):
 *
 *   - Every returned `target` is validated against an allow-list
 *     built from this org's exact id space (intrinsic fields + this
 *     org's active custom field ids + the two specials "skip" and
 *     "create_new"). Any unknown / hallucinated target → silently
 *     coerced to "skip". The model can never trick the wizard into
 *     mapping to a field that doesn't exist.
 *
 *   - Malformed JSON, non-JSON response, missing-keys payload, or any
 *     error inside the AI call (not configured, network, rate limit,
 *     token exhausted, etc.) → return all-columns-as-"skip" so the
 *     wizard falls through to fully-manual mapping. NEVER throws,
 *     NEVER blocks the wizard.
 *
 *   - `confidence` is parsed for display ordering only; it has no
 *     auto-confirm semantics. The user explicitly clicks Next.
 *
 * Telemetry: every call writes one row to ai_usage_log with
 * feature = "contacts.import.column_scan", contactId = null
 * (import-level, not per-contact), triggeredByUserId = the caller.
 * Failed calls are logged too (ok="false") — they cost no money but
 * help diagnose prompt drift.
 *
 * Pure logic (parser, allow-list builder, prompt builders) lives in
 * `import-ai-parser.ts` so unit tests can import it without dragging
 * the "use server" boundary through @/lib/db.
 */

const scanColumnsInput = z.object({
  /** CSV column headers in order. Capped at 200 to avoid runaway prompts. */
  headers: z.array(z.string().max(500)).min(1).max(200),
  /**
   * First N data rows, each as an array of cell strings aligned to
   * headers. Capped at 10 rows × 500 chars / cell — keeps the prompt
   * cheap enough that an idle Haiku call is sub-cent.
   */
  sampleRows: z.array(z.array(z.string().max(500))).max(10),
})

export interface ColumnScanResult {
  suggestions: ColumnScanSuggestion[]
  /**
   * Whether the AI call succeeded AND the parser found at least one
   * valid suggestion. False = everything fell back to "skip" (network
   * error, malformed JSON, etc.); the wizard surfaces this as "AI
   * unavailable — map manually."
   */
  ok: boolean
}

const COLUMN_SCAN_FEATURE = "contacts.import.column_scan"
const COLUMN_SCAN_MAX_TOKENS = 800

export const scanColumnsWithAi = orgAction
  .metadata({ actionName: COLUMN_SCAN_FEATURE })
  .inputSchema(scanColumnsInput)
  .action(async ({ parsedInput, ctx }): Promise<ColumnScanResult> => {
    // Org's contact custom field defs (active only). Used both for
    // the allow-list AND to enumerate cf:<id> targets to Haiku so the
    // model can pick a known custom field instead of guessing.
    const allDefs = await listFieldDefinitionsForRecordTypeWithDb(ctx.db, "contact")
    const activeDefs: CustomFieldDefForScan[] = allDefs.filter((d) => d.archivedAt === null)
    const allowedTargets = buildAllowedTargets(activeDefs)

    let result: ColumnScanResult
    let modelName = HAIKU_MODEL
    let tokensUsed: number | null = null
    let ok = false
    let errorMessage: string | null = null

    try {
      const systemPrompt = buildSystemPrompt(activeDefs)
      const userPrompt = buildUserPrompt(parsedInput.headers, parsedInput.sampleRows)
      const resp = await callAiModel({
        systemPrompt,
        userPrompt,
        model: HAIKU_MODEL,
        maxTokens: COLUMN_SCAN_MAX_TOKENS,
      })
      modelName = resp.modelName
      tokensUsed = resp.tokensUsed
      const parsed = parseColumnScanResponse(resp.raw, parsedInput.headers, allowedTargets)
      result = { suggestions: parsed.suggestions, ok: parsed.ok }
      ok = parsed.ok
      if (!parsed.ok) {
        errorMessage = `model returned no usable suggestions (stop=${resp.stopReason ?? "null"})`
      }
    } catch (err) {
      // Catch-all: ANTHROPIC_API_KEY missing, network error, timeout,
      // rate limit, etc. Mike's spec: never throw, never block.
      errorMessage = err instanceof Error ? err.message : "Unknown AI scan error"
      result = {
        suggestions: parsedInput.headers.map((h) => ({
          column: h,
          target: "skip",
          confidence: "low" as const,
        })),
        ok: false,
      }
    }

    // Best-effort telemetry. recordAiUsage swallows insert failures so
    // a telemetry hiccup never breaks the user-visible scan.
    await recordAiUsage(ctx.db, {
      organizationId: ctx.activeOrg.id,
      feature: COLUMN_SCAN_FEATURE,
      model: modelName,
      contactId: null,
      tokensUsed,
      ok,
      errorMessage,
      triggeredByUserId: ctx.session.user.id,
    })

    return result
  })
