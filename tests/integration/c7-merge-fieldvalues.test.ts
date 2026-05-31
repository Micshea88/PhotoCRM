/**
 * Push 3 (C7 rebuild) — engine accepts the new `fieldValues` wire
 * shape from the full-record grid.
 *
 * The grid resolves picks + inline edits to concrete values
 * client-side and sends them as `fieldValues`. The engine merges
 * `fieldValues` into the same override pipeline that already handled
 * the prior `customOverrides` map. Same atomic transaction: writes
 * the merged primary row, repoints FKs (notes/calls/meetings/sms/
 * opportunities/etc), soft-deletes the loser, busts primary's AI
 * cache (Fix 8 hook).
 *
 * Tests bypass the orgAction wrapper (needs cookies) and call the
 * engine directly with a tx-scoped setOrgContext — same pattern as
 * the existing duplicates-merge + c7-merge-pairwise integration
 * tests.
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts, contactNotes } from "@/modules/contacts/schema"
import { executeContactMerge } from "@/modules/duplicates/merge-engine"

async function seedContact(
  db: Parameters<typeof executeContactMerge>[0],
  orgId: string,
  userId: string,
  patch: Partial<typeof contacts.$inferInsert> = {},
) {
  const id = createId()
  await db.insert(contacts).values({
    id,
    organizationId: orgId,
    firstName: patch.firstName ?? "F",
    lastName: patch.lastName ?? "L",
    primaryEmail: patch.primaryEmail ?? null,
    secondaryEmail: patch.secondaryEmail ?? null,
    primaryPhone: patch.primaryPhone ?? null,
    contactType: patch.contactType ?? "Lead",
    leadSource: patch.leadSource ?? null,
    tags: patch.tags ?? null,
    mailingAddress: patch.mailingAddress ?? null,
    customFields: patch.customFields ?? null,
    aiSummaryText: patch.aiSummaryText ?? null,
    aiGeneratedAt: patch.aiGeneratedAt ?? null,
    aiGenerationModel: patch.aiGenerationModel ?? null,
    createdBy: userId,
    updatedBy: userId,
  })
  return id
}

describe("C7 rebuild — fieldValues wire shape", () => {
  it("fieldValues takes top precedence over fieldChoices / customOverrides", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const a = await seedContact(db, orgId, userId, { firstName: "Alpha" })
      const b = await seedContact(db, orgId, userId, { firstName: "Beta" })

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId: a,
          loserIds: [b],
          // Legacy pick says use Beta; legacy override says use 'Gamma'.
          // Final fieldValues says 'Delta'. Delta wins.
          fieldChoices: { firstName: b },
          customOverrides: { firstName: "Gamma" },
          fieldValues: { firstName: "Delta" },
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )
      const [winner] = await db.select().from(contacts).where(eq(contacts.id, a))
      expect(winner?.firstName).toBe("Delta")
    })
  })

  it("fieldValues drives the full standard field set in a single call", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const a = await seedContact(db, orgId, userId, {
        firstName: "Alpha",
        lastName: "One",
        primaryEmail: "alpha@one.com",
        leadSource: "Web",
        contactType: "Lead",
      })
      const b = await seedContact(db, orgId, userId, {
        firstName: "Beta",
        lastName: "Two",
        primaryEmail: "beta@two.com",
        leadSource: "Referral",
        contactType: "Lead",
      })

      // The C7 grid resolves the picks + inline edits into the
      // concrete final values for every field. Test that the engine
      // writes every key as-is.
      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId: a,
          loserIds: [b],
          fieldChoices: {},
          fieldValues: {
            firstName: "Alpha",
            lastName: "Two",
            primaryEmail: "alpha@one.com",
            secondaryEmail: "beta@two.com",
            leadSource: "Referral",
            contactType: "Lead",
            notes: "Merged",
            mailingAddress: { street1: "100 Main", city: "Tampa", state: "FL", zip: "33602" },
          },
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )
      const [winner] = await db.select().from(contacts).where(eq(contacts.id, a))
      expect(winner?.firstName).toBe("Alpha")
      expect(winner?.lastName).toBe("Two")
      expect(winner?.primaryEmail).toBe("alpha@one.com")
      expect(winner?.secondaryEmail).toBe("beta@two.com")
      expect(winner?.leadSource).toBe("Referral")
      expect(winner?.notes).toBe("Merged")
      expect(winner?.mailingAddress).toEqual({
        street1: "100 Main",
        city: "Tampa",
        state: "FL",
        zip: "33602",
      })
    })
  })

  it("fieldValues custom-field key (cf:<defId>) writes into the merged customFields jsonb", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const a = await seedContact(db, orgId, userId, {
        customFields: { cf_vendor_referrals: "old" },
      })
      const b = await seedContact(db, orgId, userId)

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId: a,
          loserIds: [b],
          fieldChoices: {},
          fieldValues: { "cf:cf_vendor_referrals": "TOP 10 Vendor Referrals List" },
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )
      const [winner] = await db.select().from(contacts).where(eq(contacts.id, a))
      expect(winner?.customFields?.cf_vendor_referrals).toBe("TOP 10 Vendor Referrals List")
    })
  })

  it("post-merge cleanup unchanged — secondary soft-deleted, notes relinked, AI cache busted", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winner = await seedContact(db, orgId, userId, {
        aiSummaryText: "stale",
        aiGeneratedAt: new Date(),
        aiGenerationModel: "claude-haiku-4-5-20251001",
      })
      const loser = await seedContact(db, orgId, userId)
      await db.insert(contactNotes).values({
        id: createId(),
        organizationId: orgId,
        contactId: loser,
        body: "Loser's note",
        createdBy: userId,
        updatedBy: userId,
      })

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId: winner,
          loserIds: [loser],
          fieldChoices: {},
          fieldValues: { firstName: "Final" },
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      const [winnerRow] = await db.select().from(contacts).where(eq(contacts.id, winner))
      expect(winnerRow?.firstName).toBe("Final")
      expect(winnerRow?.aiSummaryText).toBeNull()
      expect(winnerRow?.aiGeneratedAt).toBeNull()
      expect(winnerRow?.aiGenerationModel).toBeNull()

      const [loserRow] = await db.select().from(contacts).where(eq(contacts.id, loser))
      expect(loserRow?.deletedAt).not.toBeNull()

      const notesOnWinner = await db
        .select()
        .from(contactNotes)
        .where(eq(contactNotes.contactId, winner))
      expect(notesOnWinner.length).toBe(1)
    })
  })
})
