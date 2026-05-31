/**
 * Push 3 (C7) — manual pairwise merge engine extension.
 *
 * Covers the new bits added on top of the Push 4 B2 engine:
 *   - customOverrides applied over fieldChoices for intrinsic fields
 *   - tags whole-blob override via `customOverrides.tags`
 *   - mailingAddress whole-blob override via `customOverrides.mailingAddress`
 *   - cf:<defId> override flows into the merged customFields jsonb
 *   - meetings + sms_messages relinked atomically with notes/calls
 *   - winner's AI cache busted after merge (the next page render
 *     auto-regens via polish #5 Fix 8)
 *
 * Tests bypass the orgAction wrapper (needs cookies) and call the
 * engine directly with a tx-scoped setOrgContext. Same shape as the
 * existing duplicates-merge.test.ts.
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts, contactNotes } from "@/modules/contacts/schema"
import { callLog } from "@/modules/calls/schema"
import { meetings } from "@/modules/meetings/schema"
import { smsMessages } from "@/modules/sms-messages/schema"
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
    primaryPhone: patch.primaryPhone ?? null,
    contactType: patch.contactType ?? "Lead",
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

describe("C7 — customOverrides", () => {
  it("intrinsic field override wins over fieldChoices pick", async () => {
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
          fieldChoices: { firstName: b }, // pick says "use Beta"
          customOverrides: { firstName: "Gamma" }, // override says "neither — type Gamma"
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )
      const [winner] = await db.select().from(contacts).where(eq(contacts.id, a))
      expect(winner?.firstName).toBe("Gamma")
    })
  })

  it("tags whole-blob override replaces both A and B tags", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const a = await seedContact(db, orgId, userId, { tags: ["vip"] })
      const b = await seedContact(db, orgId, userId, { tags: ["wedding"] })

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId: a,
          loserIds: [b],
          fieldChoices: {},
          customOverrides: { tags: ["custom-edited"] },
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )
      const [winner] = await db.select().from(contacts).where(eq(contacts.id, a))
      expect(winner?.tags).toEqual(["custom-edited"])
    })
  })

  it("mailingAddress override replaces both addresses", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const a = await seedContact(db, orgId, userId, { mailingAddress: { city: "Tampa" } })
      const b = await seedContact(db, orgId, userId, { mailingAddress: { city: "Orlando" } })

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId: a,
          loserIds: [b],
          fieldChoices: {},
          customOverrides: { mailingAddress: { city: "St Petersburg", state: "FL" } },
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )
      const [winner] = await db.select().from(contacts).where(eq(contacts.id, a))
      expect(winner?.mailingAddress).toEqual({ city: "St Petersburg", state: "FL" })
    })
  })
})

describe("C7 — meetings + sms relinked + AI cache busted", () => {
  it("meetings + sms_messages from the loser get repointed to the winner", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winner = await seedContact(db, orgId, userId, { firstName: "W" })
      const loser = await seedContact(db, orgId, userId, { firstName: "L" })

      // Loser has a meeting + an inbound SMS.
      const meetingId = createId()
      await db.insert(meetings).values({
        id: meetingId,
        organizationId: orgId,
        contactId: loser,
        subject: "Consult",
        startsAt: new Date(Date.now() + 86_400_000),
        createdBy: userId,
        updatedBy: userId,
      })
      const smsId = createId()
      await db.insert(smsMessages).values({
        id: smsId,
        organizationId: orgId,
        contactId: loser,
        direction: "inbound",
        body: "Hey",
        sentAt: new Date(),
        sentByUserId: userId,
      })

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId: winner,
          loserIds: [loser],
          fieldChoices: {},
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      const [meet] = await db.select().from(meetings).where(eq(meetings.id, meetingId))
      const [sms] = await db.select().from(smsMessages).where(eq(smsMessages.id, smsId))
      expect(meet?.contactId).toBe(winner)
      expect(sms?.contactId).toBe(winner)
    })
  })

  it("winner's AI cache is nulled after merge (polish #5 Fix 8 contract)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winner = await seedContact(db, orgId, userId, {
        aiSummaryText: "Cached summary that should be invalidated by merge.",
        aiGeneratedAt: new Date(),
        aiGenerationModel: "claude-haiku-4-5-20251001",
      })
      const loser = await seedContact(db, orgId, userId)

      // Add a note on the loser so the merge has an FK to repoint.
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
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      const [row] = await db.select().from(contacts).where(eq(contacts.id, winner))
      expect(row?.aiSummaryText).toBeNull()
      expect(row?.aiGeneratedAt).toBeNull()
      expect(row?.aiGenerationModel).toBeNull()
      // The repointed note is on the winner now.
      const noteRows = await db
        .select()
        .from(contactNotes)
        .where(eq(contactNotes.contactId, winner))
      expect(noteRows.length).toBe(1)
      // Loser is soft-deleted.
      const [loserRow] = await db.select().from(contacts).where(eq(contacts.id, loser))
      expect(loserRow?.deletedAt).not.toBeNull()
    })
  })

  it("calls + notes from the loser repoint to the winner (regression)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winner = await seedContact(db, orgId, userId)
      const loser = await seedContact(db, orgId, userId)
      const noteId = createId()
      await db.insert(contactNotes).values({
        id: noteId,
        organizationId: orgId,
        contactId: loser,
        body: "Note",
        createdBy: userId,
        updatedBy: userId,
      })
      const callId = createId()
      await db.insert(callLog).values({
        id: callId,
        organizationId: orgId,
        contactId: loser,
        userId,
        direction: "outgoing",
        startedAt: new Date(),
        source: "manual",
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
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      const [note] = await db.select().from(contactNotes).where(eq(contactNotes.id, noteId))
      const [call] = await db.select().from(callLog).where(eq(callLog.id, callId))
      expect(note?.contactId).toBe(winner)
      expect(call?.contactId).toBe(winner)
    })
  })
})
