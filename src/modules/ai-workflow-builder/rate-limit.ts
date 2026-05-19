import "server-only"
import { and, eq, gte } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { env } from "@/lib/env"
import { aiWorkflowDrafts } from "./schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Rate-limit posture — OPERATOR-COST / abuse backstop, NOT a user
 * paywall or usage tier. Defaults are GENEROUS — invisible to
 * honest use, hard ceiling only against runaway / abuse / bug.
 *
 * This is recorded as the explicit posture in the module README so
 * future contributors don't mistake it for a usage gate later.
 *
 * Reads from env (module 16b). Defaults: 100/hr per user, 500/hr
 * per org, 2000/day per org.
 *
 * Rejected and refused drafts COUNT toward the limit — a user
 * attempting to evade the validation gate via repeated bad prompts
 * still hits the ceiling.
 */
export const DEFAULT_HOURLY_USER_LIMIT = env.AI_WORKFLOW_BUILDER_HOURLY_USER
export const DEFAULT_HOURLY_ORG_LIMIT = env.AI_WORKFLOW_BUILDER_HOURLY_ORG
export const DEFAULT_DAILY_ORG_LIMIT = env.AI_WORKFLOW_BUILDER_DAILY_ORG

export interface RateLimitConfig {
  hourlyPerOrg: number
  hourlyPerUser: number
  dailyPerOrg: number
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  hourlyPerOrg: DEFAULT_HOURLY_ORG_LIMIT,
  hourlyPerUser: DEFAULT_HOURLY_USER_LIMIT,
  dailyPerOrg: DEFAULT_DAILY_ORG_LIMIT,
}

export type RateLimitVerdict = { allowed: true } | { allowed: false; reason: string }

/**
 * Returns `allowed: true` if the (org, user) is under all three limits.
 * Counts every draft row in the time window — regardless of `status`.
 * A user who triggers 10 validation failures still gets rate-limited.
 */
export async function checkRateLimit(
  db: DbHandle,
  args: { organizationId: string; userId: string },
  config: RateLimitConfig = DEFAULT_RATE_LIMITS,
): Promise<RateLimitVerdict> {
  const now = Date.now()
  const oneHourAgo = new Date(now - 60 * 60 * 1000)
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000)

  // Per-user hourly count.
  const perUserHourly = await db
    .select({ id: aiWorkflowDrafts.id })
    .from(aiWorkflowDrafts)
    .where(
      and(
        eq(aiWorkflowDrafts.organizationId, args.organizationId),
        eq(aiWorkflowDrafts.requesterUserId, args.userId),
        gte(aiWorkflowDrafts.createdAt, oneHourAgo),
      ),
    )
  if (perUserHourly.length >= config.hourlyPerUser) {
    return {
      allowed: false,
      reason: `Per-user hourly limit reached (${String(config.hourlyPerUser)} drafts/hr). Try again later.`,
    }
  }

  // Per-org hourly count.
  const perOrgHourly = await db
    .select({ id: aiWorkflowDrafts.id })
    .from(aiWorkflowDrafts)
    .where(
      and(
        eq(aiWorkflowDrafts.organizationId, args.organizationId),
        gte(aiWorkflowDrafts.createdAt, oneHourAgo),
      ),
    )
  if (perOrgHourly.length >= config.hourlyPerOrg) {
    return {
      allowed: false,
      reason: `Organization hourly limit reached (${String(config.hourlyPerOrg)} drafts/hr). Try again later.`,
    }
  }

  // Per-org daily count.
  const perOrgDaily = await db
    .select({ id: aiWorkflowDrafts.id })
    .from(aiWorkflowDrafts)
    .where(
      and(
        eq(aiWorkflowDrafts.organizationId, args.organizationId),
        gte(aiWorkflowDrafts.createdAt, oneDayAgo),
      ),
    )
  if (perOrgDaily.length >= config.dailyPerOrg) {
    return {
      allowed: false,
      reason: `Organization daily limit reached (${String(config.dailyPerOrg)} drafts/day). Try again tomorrow.`,
    }
  }

  return { allowed: true }
}
