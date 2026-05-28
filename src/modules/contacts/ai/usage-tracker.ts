import "server-only"
import { createId } from "@paralleldrive/cuid2"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { aiUsageLog } from "./ai-usage-schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Push 3 (C6b) — minimal append-only AI usage log.
 *
 * Called from every Haiku / Sonnet code path in the contacts AI
 * engine. Logs both successes and failures (fallbacks) — failure
 * rows cost no money but signal config drift / prompt regressions.
 *
 * No rate limiting; that's a follow-up if usage grows. Visibility
 * now, throttling later.
 */
export interface RecordAiUsageArgs {
  organizationId: string
  feature: string
  model: string
  contactId?: string | null
  tokensUsed?: number | null
  ok: boolean
  errorMessage?: string | null
  triggeredByUserId?: string | null
}

export async function recordAiUsage(db: DbHandle, args: RecordAiUsageArgs): Promise<void> {
  // Best-effort log — if the insert fails (e.g., FK violation, RLS
  // mis-config) we swallow the error so the user-visible AI flow
  // doesn't blow up over a missing telemetry row. The action layer
  // already audited the regenerate call; telemetry is gravy.
  try {
    await db.insert(aiUsageLog).values({
      id: createId(),
      organizationId: args.organizationId,
      feature: args.feature,
      model: args.model,
      contactId: args.contactId ?? null,
      tokensUsed: args.tokensUsed ?? null,
      ok: args.ok ? "true" : "false",
      errorMessage: args.errorMessage ?? null,
      triggeredByUserId: args.triggeredByUserId ?? null,
    })
  } catch {
    // intentionally swallowed — see comment above
  }
}
