/**
 * AI-summary freshness — activity touch (formerly "cache invalidation").
 *
 * The freshness model changed: instead of NULLing the AI cache when activity
 * is added (which made the stale summary vanish until regen), activity now
 * BUMPS `last_activity_at` and LEAVES THE CACHE INTACT. The contact page shows
 * the cached summary immediately and the client swaps in a fresh one in place
 * when `last_activity_at > ai_generated_at` (or 1h elapsed).
 *
 * `touchContactActivity` is the helper every activity action calls (notes,
 * calls, meetings, SMS, email, contact-scoped tasks, contact record edits).
 * These tests bypass the orgAction wrappers and exercise it directly.
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts, contactNotes } from "@/modules/contacts/schema"
import { touchContactActivity } from "@/modules/contacts/ai/cache-invalidation"

const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000)

async function seedContactWithCache(
  db: Parameters<typeof touchContactActivity>[0],
  orgId: string,
  userId: string,
) {
  const cid = createId()
  await db.insert(contacts).values({
    id: cid,
    organizationId: orgId,
    firstName: "Cached",
    lastName: "Contact",
    contactType: "Lead",
    aiLeadStatus: "New Lead",
    aiLeadStatusReasoning: "New contact — no activity yet.",
    aiSummaryText: "New lead from Web. No activity logged yet.",
    aiInsightsJson: { insights: [], version: 1 },
    aiGeneratedAt: TWO_HOURS_AGO,
    aiGenerationModel: "deterministic-floor@1",
    createdBy: userId,
    updatedBy: userId,
  })
  return cid
}

describe("touchContactActivity — bumps last_activity_at, preserves the cache", () => {
  it("sets last_activity_at newer than the summary WITHOUT nulling any cache field", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = await seedContactWithCache(db, orgId, userId)
      await touchContactActivity(db, orgId, cid)

      const [after] = await db.select().from(contacts).where(eq(contacts.id, cid))
      // Freshness signal: activity is now newer than the summary → page will refresh.
      expect(after?.lastActivityAt).toBeInstanceOf(Date)
      expect(after!.lastActivityAt!.getTime()).toBeGreaterThan(after!.aiGeneratedAt!.getTime())
      // Cache is PRESERVED (the stale summary stays visible until the swap).
      expect(after?.aiSummaryText).toContain("New lead from")
      expect(after?.aiLeadStatus).toBe("New Lead")
      expect(after?.aiInsightsJson).not.toBeNull()
      expect(after?.aiGeneratedAt).toBeInstanceOf(Date)
      expect(after?.aiGenerationModel).toBe("deterministic-floor@1")
    })
  })

  it("scopes the UPDATE to the matching orgId — won't touch a different org's contact", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgA = await createOrganization(db, userId)
      const orgB = await createOrganization(db, userId)
      await setOrgContext(db, orgA, "owner", userId)
      const cidA = await seedContactWithCache(db, orgA, userId)

      // Call with the WRONG org → no rows updated.
      await touchContactActivity(db, orgB, cidA)

      await setOrgContext(db, orgA, "owner", userId)
      const [row] = await db.select().from(contacts).where(eq(contacts.id, cidA))
      expect(row?.lastActivityAt).toBeNull()
    })
  })

  it("activity insert + touch → last_activity_at reflects the new activity, cache intact", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = await seedContactWithCache(db, orgId, userId)
      await db.insert(contactNotes).values({
        id: createId(),
        organizationId: orgId,
        contactId: cid,
        body: "Met for coffee — wants to book.",
        createdBy: userId,
        updatedBy: userId,
      })
      await touchContactActivity(db, orgId, cid)

      const [row] = await db.select().from(contacts).where(eq(contacts.id, cid))
      expect(row?.lastActivityAt).toBeInstanceOf(Date)
      expect(row!.lastActivityAt!.getTime()).toBeGreaterThan(row!.aiGeneratedAt!.getTime())
      expect(row?.aiSummaryText).toContain("New lead from")
    })
  })
})
