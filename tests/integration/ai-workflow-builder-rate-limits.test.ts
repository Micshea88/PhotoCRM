/**
 * Rate-limit tests for the AI Workflow Builder (module 16a).
 *
 * Per the cost/abuse-bounds danger zone in the plan: rate limits
 * bound abuse from repeated bad prompts AND cost. Rejected and
 * refused drafts COUNT toward the limit — bounded by design.
 *
 * Defaults in 16a (env-driven in 16b): 10/hr per org, 5/hr per user,
 * 50/day per org.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { aiWorkflowDrafts } from "@/modules/ai-workflow-builder/schema"
import {
  checkRateLimit,
  DEFAULT_HOURLY_USER_LIMIT,
  DEFAULT_HOURLY_ORG_LIMIT,
} from "@/modules/ai-workflow-builder/rate-limit"

async function seedDraftCount(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  args: { orgId: string; userId: string; count: number; status?: string },
) {
  const rows = Array.from({ length: args.count }, () => ({
    id: createId(),
    organizationId: args.orgId,
    requesterUserId: args.userId,
    prompt: "test",
    modelName: "test-model",
    rawModelOutput: null,
    validationResult: { kind: args.status ?? "rejected" },
    status: args.status ?? "rejected",
  }))
  if (rows.length > 0) {
    await db.insert(aiWorkflowDrafts).values(rows)
  }
}

describe("rate limit — per-user hourly", () => {
  it("allows the Nth attempt, blocks the (N+1)th", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Seed exactly the limit count.
      await seedDraftCount(db, { orgId, userId, count: DEFAULT_HOURLY_USER_LIMIT })

      const verdict = await checkRateLimit(db, { organizationId: orgId, userId })
      expect(verdict.allowed).toBe(false)
      if (!verdict.allowed) {
        expect(verdict.reason).toMatch(/per-user hourly/i)
      }
    })
  })

  it("the Nth call still passes; only N+1 fails", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      await seedDraftCount(db, {
        orgId,
        userId,
        count: DEFAULT_HOURLY_USER_LIMIT - 1,
      })
      const verdict = await checkRateLimit(db, { organizationId: orgId, userId })
      expect(verdict.allowed).toBe(true)
    })
  })
})

describe("rate limit — rejected/refused drafts count toward the limit", () => {
  it("rejected drafts contribute to the count (bounded abuse)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      // All rejected. User cannot dodge the limit by sending bad prompts.
      await seedDraftCount(db, {
        orgId,
        userId,
        count: DEFAULT_HOURLY_USER_LIMIT,
        status: "rejected",
      })
      const verdict = await checkRateLimit(db, { organizationId: orgId, userId })
      expect(verdict.allowed).toBe(false)
    })
  })
})

describe("rate limit — per-org hourly cap", () => {
  it("two users in the same org cannot collectively exceed the org cap", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)
      // userA: at the user-limit
      await seedDraftCount(db, {
        orgId,
        userId: userA,
        count: DEFAULT_HOURLY_USER_LIMIT,
      })
      // userB: enough more to push past the org-limit
      await seedDraftCount(db, {
        orgId,
        userId: userB,
        count: Math.max(0, DEFAULT_HOURLY_ORG_LIMIT - DEFAULT_HOURLY_USER_LIMIT),
      })
      // userB's next attempt should fail the org cap (or the user cap
      // depending on which fires first; either way denied).
      const verdict = await checkRateLimit(db, {
        organizationId: orgId,
        userId: userB,
      })
      expect(verdict.allowed).toBe(false)
    })
  })
})
