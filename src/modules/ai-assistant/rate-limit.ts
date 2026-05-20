import "server-only"
import { and, eq, gte } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { env } from "@/lib/env"
import { aiAssistantMessages } from "./schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Rate-limit posture for the AI Assistant — OPERATOR-COST / abuse
 * backstop, NOT a user paywall. Same locked posture as the ai-workflow-
 * builder (docs/PIVOTS_LEDGER.md, module-16b row).
 *
 * Defaults: 300/hr per user, 1500/hr per org, 6000/day per org —
 * generous (invisible to honest use), hard ceiling only against
 * runaway / abuse / bug. Tuned for the assistant's higher
 * conversation volume vs the workflow builder's drafting volume.
 *
 * Counts every `user`-role message — i.e., a user-initiated turn.
 * Refusals, retrievals, and assistant replies do not count separately
 * because they're not user-initiated. A user message generates 1 turn
 * regardless of how many tool calls or replies it produces in 17b+.
 *
 * If a future change turns this into a paid-plan gate, that is a
 * separate flagged decision per the locked posture.
 */
export const DEFAULT_HOURLY_USER_LIMIT = env.AI_ASSISTANT_HOURLY_USER
export const DEFAULT_HOURLY_ORG_LIMIT = env.AI_ASSISTANT_HOURLY_ORG
export const DEFAULT_DAILY_ORG_LIMIT = env.AI_ASSISTANT_DAILY_ORG

export interface RateLimitConfig {
  hourlyPerUser: number
  hourlyPerOrg: number
  dailyPerOrg: number
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  hourlyPerUser: DEFAULT_HOURLY_USER_LIMIT,
  hourlyPerOrg: DEFAULT_HOURLY_ORG_LIMIT,
  dailyPerOrg: DEFAULT_DAILY_ORG_LIMIT,
}

export type RateLimitVerdict = { allowed: true } | { allowed: false; reason: string }

export async function checkRateLimit(
  db: DbHandle,
  args: { organizationId: string; userId: string },
  config: RateLimitConfig = DEFAULT_RATE_LIMITS,
): Promise<RateLimitVerdict> {
  const now = Date.now()
  const oneHourAgo = new Date(now - 60 * 60 * 1000)
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000)

  const perUser = await db
    .select({ id: aiAssistantMessages.id })
    .from(aiAssistantMessages)
    .where(
      and(
        eq(aiAssistantMessages.organizationId, args.organizationId),
        eq(aiAssistantMessages.userId, args.userId),
        eq(aiAssistantMessages.role, "user"),
        gte(aiAssistantMessages.createdAt, oneHourAgo),
      ),
    )
  if (perUser.length >= config.hourlyPerUser) {
    return {
      allowed: false,
      reason: `Per-user hourly limit reached (${String(config.hourlyPerUser)} messages/hr). Try again later.`,
    }
  }

  const perOrgHourly = await db
    .select({ id: aiAssistantMessages.id })
    .from(aiAssistantMessages)
    .where(
      and(
        eq(aiAssistantMessages.organizationId, args.organizationId),
        eq(aiAssistantMessages.role, "user"),
        gte(aiAssistantMessages.createdAt, oneHourAgo),
      ),
    )
  if (perOrgHourly.length >= config.hourlyPerOrg) {
    return {
      allowed: false,
      reason: `Organization hourly limit reached (${String(config.hourlyPerOrg)} messages/hr).`,
    }
  }

  const perOrgDaily = await db
    .select({ id: aiAssistantMessages.id })
    .from(aiAssistantMessages)
    .where(
      and(
        eq(aiAssistantMessages.organizationId, args.organizationId),
        eq(aiAssistantMessages.role, "user"),
        gte(aiAssistantMessages.createdAt, oneDayAgo),
      ),
    )
  if (perOrgDaily.length >= config.dailyPerOrg) {
    return {
      allowed: false,
      reason: `Organization daily limit reached (${String(config.dailyPerOrg)} messages/day). Try again tomorrow.`,
    }
  }

  return { allowed: true }
}
