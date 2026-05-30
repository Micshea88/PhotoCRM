/**
 * Push 3 (C6c polish #5 Fix 8) — AI cache invalidation when activity
 * is added.
 *
 * Bug: createContactNote / logCall used to leave the contact's AI
 * cache fields untouched, so the next page render saw the 7-day-
 * fresh cache and didn't auto-regenerate. Users who added a note
 * after the initial deterministic-floor cache write saw the stale
 * "New lead from X. No activity logged yet." summary forever.
 *
 * Fix: `invalidateContactAiCache` nulls all 6 ai_* cache fields
 * inside the same orgAction transaction as the activity insert.
 *
 * These tests bypass the orgAction wrappers (which need cookies) and
 * exercise the contract by calling the underlying invalidation
 * helper directly + asserting the cache columns are null.
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts, contactNotes } from "@/modules/contacts/schema"
import { callLog } from "@/modules/calls/schema"
import { invalidateContactAiCache } from "@/modules/contacts/ai/cache-invalidation"

async function seedContactWithCache(
  db: Parameters<typeof invalidateContactAiCache>[0],
  orgId: string,
  userId: string,
) {
  const cid = createId()
  const generatedAt = new Date()
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
    aiGeneratedAt: generatedAt,
    aiGenerationModel: "deterministic-floor@1",
    createdBy: userId,
    updatedBy: userId,
  })
  return cid
}

describe("invalidateContactAiCache — nulls all 6 cache fields", () => {
  it("clears aiLeadStatus / aiLeadStatusReasoning / aiSummaryText / aiInsightsJson / aiGeneratedAt / aiGenerationModel", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = await seedContactWithCache(db, orgId, userId)

      // Sanity — the seed populated the cache.
      const [before] = await db.select().from(contacts).where(eq(contacts.id, cid))
      expect(before?.aiSummaryText).toContain("New lead from")
      expect(before?.aiGeneratedAt).toBeInstanceOf(Date)

      await invalidateContactAiCache(db, orgId, cid)

      const [after] = await db.select().from(contacts).where(eq(contacts.id, cid))
      expect(after?.aiLeadStatus).toBeNull()
      expect(after?.aiLeadStatusReasoning).toBeNull()
      expect(after?.aiSummaryText).toBeNull()
      expect(after?.aiInsightsJson).toBeNull()
      expect(after?.aiGeneratedAt).toBeNull()
      expect(after?.aiGenerationModel).toBeNull()
    })
  })

  it("scopes the UPDATE to the matching orgId — won't null a different org's cache", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgA = await createOrganization(db, userId)
      const orgB = await createOrganization(db, userId)
      await setOrgContext(db, orgA, "owner", userId)
      const cidA = await seedContactWithCache(db, orgA, userId)

      // Call with the WRONG org → no rows updated.
      await invalidateContactAiCache(db, orgB, cidA)

      await setOrgContext(db, orgA, "owner", userId)
      const [stillCached] = await db.select().from(contacts).where(eq(contacts.id, cidA))
      expect(stillCached?.aiSummaryText).toContain("New lead from")
      expect(stillCached?.aiGeneratedAt).toBeInstanceOf(Date)
    })
  })
})

describe("Activity insert → cache invalidation contract", () => {
  it("inserting a contact_note + calling invalidateContactAiCache leaves cache null", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = await seedContactWithCache(db, orgId, userId)

      // Simulate the createContactNote action body: insert note +
      // invalidate cache. (The orgAction wrapper is out of scope
      // here — see ai-regenerate.test.ts for why.)
      await db.insert(contactNotes).values({
        id: createId(),
        organizationId: orgId,
        contactId: cid,
        body: "Met for coffee — wants to book.",
        createdBy: userId,
        updatedBy: userId,
      })
      await invalidateContactAiCache(db, orgId, cid)

      const [row] = await db.select().from(contacts).where(eq(contacts.id, cid))
      expect(row?.aiSummaryText).toBeNull()
      expect(row?.aiGeneratedAt).toBeNull()
      expect(row?.aiGenerationModel).toBeNull()
    })
  })

  it("inserting a call_log + calling invalidateContactAiCache leaves cache null", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = await seedContactWithCache(db, orgId, userId)

      await db.insert(callLog).values({
        id: createId(),
        organizationId: orgId,
        contactId: cid,
        userId,
        direction: "outgoing",
        startedAt: new Date(),
        durationSeconds: 240,
        source: "manual",
        createdBy: userId,
        updatedBy: userId,
      })
      await invalidateContactAiCache(db, orgId, cid)

      const [row] = await db.select().from(contacts).where(eq(contacts.id, cid))
      expect(row?.aiSummaryText).toBeNull()
      expect(row?.aiInsightsJson).toBeNull()
      expect(row?.aiLeadStatus).toBeNull()
    })
  })
})
