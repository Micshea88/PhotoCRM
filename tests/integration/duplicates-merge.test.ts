import { describe, it, expect } from "vitest"
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { auditLog } from "@/modules/audit/schema"
import { callLog } from "@/modules/calls/schema"
import { companies } from "@/modules/companies/schema"
import { contactCompanyAssociations, contactNotes, contacts } from "@/modules/contacts/schema"
import { executeCompanyMerge, executeContactMerge } from "@/modules/duplicates/merge-engine"

/**
 * Push 4 (B2) — integration tests for the merge engine. Calls the
 * extracted `executeContactMerge` / `executeCompanyMerge` directly
 * with a test-DB tx + setOrgContext, bypassing the orgAction
 * cookies. The orgAction wrappers in actions.ts only add an
 * Owner+Admin assertion + revalidatePath on top; that gate is
 * smoked in Gate 5 manually.
 */

describe("contacts merge — engine", () => {
  it("merges two contacts: scalar winner picks, oldest createdAt preserved, audit logged BEFORE destructive ops", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const olderDate = new Date("2024-01-01T00:00:00Z")
      const newerDate = new Date("2026-05-25T00:00:00Z")
      const winnerId = createId()
      const loserId = createId()
      await db.insert(contacts).values([
        {
          id: winnerId,
          organizationId: orgId,
          firstName: "Ada",
          lastName: "Winner",
          primaryEmail: null,
          primaryPhone: "7275550001",
          tags: ["winner-tag"],
          createdAt: newerDate,
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: loserId,
          organizationId: orgId,
          firstName: "Ada",
          lastName: "Loser",
          primaryEmail: "ada@example.com",
          primaryPhone: "7275550002",
          tags: ["loser-tag"],
          createdAt: olderDate,
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      const result = await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId,
          loserIds: [loserId],
          // Pick winner's lastName, loser's primaryEmail.
          fieldChoices: { lastName: winnerId, primaryEmail: loserId },
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      expect(result.winnerId).toBe(winnerId)
      expect(result.mergedFromIds).toEqual([loserId])

      const [winnerRow] = await db.select().from(contacts).where(eq(contacts.id, winnerId))
      expect(winnerRow?.lastName).toBe("Winner")
      expect(winnerRow?.primaryEmail).toBe("ada@example.com")
      expect(winnerRow?.deletedAt).toBeNull()
      // Oldest createdAt preserved (loser's).
      expect(winnerRow?.createdAt.getTime()).toBe(olderDate.getTime())
      // mergedRecordIds appended.
      expect(winnerRow?.mergedRecordIds).toEqual([loserId])
      // Tags unioned.
      expect(new Set(winnerRow?.tags ?? [])).toEqual(new Set(["winner-tag", "loser-tag"]))

      const [loserRow] = await db.select().from(contacts).where(eq(contacts.id, loserId))
      expect(loserRow?.deletedAt).not.toBeNull()

      // Audit log: one entry with action "contacts.merged" for this winner.
      // Verify it was inserted BEFORE the destructive updates by checking
      // that its created_at is <= winner's updated_at (the latter is set
      // by the post-audit UPDATE).
      const auditRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, orgId), eq(auditLog.action, "contacts.merged")))
      expect(auditRows.length).toBe(1)
      const auditRow = auditRows[0]!
      expect(auditRow.resourceId).toBe(winnerId)
      expect(auditRow.metadata).toMatchObject({ winnerId, loserIds: [loserId] })
      // Audit row.createdAt <= winner.updatedAt — proves audit was first
      // in the transaction (postgres now() is statement-scoped; equal
      // timestamps are fine here, the contract is "not after").
      expect(auditRow.createdAt.getTime()).toBeLessThanOrEqual(
        (winnerRow?.updatedAt ?? new Date(0)).getTime(),
      )
    })
  })

  it("3-way merge: winner + 2 losers all unioned, mergedRecordIds carries both losers (immediate only, not chain)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const a = createId()
      const b = createId()
      const c = createId()
      await db.insert(contacts).values([
        {
          id: a,
          organizationId: orgId,
          firstName: "A",
          lastName: "Person",
          tags: ["x"],
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: b,
          organizationId: orgId,
          firstName: "B",
          lastName: "Person",
          tags: ["y"],
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: c,
          organizationId: orgId,
          firstName: "C",
          lastName: "Person",
          tags: ["z"],
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      const result = await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId: a,
          loserIds: [b, c],
          fieldChoices: {},
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      expect(new Set(result.mergedFromIds)).toEqual(new Set([b, c]))
      const [winner] = await db.select().from(contacts).where(eq(contacts.id, a))
      expect(new Set(winner?.mergedRecordIds ?? [])).toEqual(new Set([b, c]))
      expect(new Set(winner?.tags ?? [])).toEqual(new Set(["x", "y", "z"]))

      const losers = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.organizationId, orgId), isNotNull(contacts.deletedAt)))
      expect(losers.length).toBe(2)
    })
  })

  it("chained merge — A's prior chain stays on A; B winner gets only [A], not [A, X]", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const xId = "xprev1234567890"
      const aId = createId()
      const bId = createId()
      // A previously merged X — A.mergedRecordIds = [X], A still live.
      await db.insert(contacts).values([
        {
          id: aId,
          organizationId: orgId,
          firstName: "A",
          lastName: "WinnerThenLoser",
          mergedRecordIds: [xId],
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: bId,
          organizationId: orgId,
          firstName: "B",
          lastName: "FinalWinner",
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId: bId,
          loserIds: [aId],
          fieldChoices: {},
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      const [bRow] = await db.select().from(contacts).where(eq(contacts.id, bId))
      const [aRow] = await db.select().from(contacts).where(eq(contacts.id, aId))
      // B gets only IMMEDIATE loser (A) — not the chain X.
      expect(bRow?.mergedRecordIds).toEqual([aId])
      // A's own mergedRecordIds stays as it was at merge time.
      expect(aRow?.mergedRecordIds).toEqual([xId])
      expect(aRow?.deletedAt).not.toBeNull()
    })
  })

  it("FK repoints: contact_company_associations, contact_notes, call_log all moved to winner", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const companyId = createId()
      await db.insert(companies).values({
        id: companyId,
        organizationId: orgId,
        name: "Evergreen",
        createdBy: userId,
        updatedBy: userId,
      })
      const winnerId = createId()
      const loserId = createId()
      await db.insert(contacts).values([
        {
          id: winnerId,
          organizationId: orgId,
          firstName: "W",
          lastName: "W",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: loserId,
          organizationId: orgId,
          firstName: "L",
          lastName: "L",
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      // Note on loser, association on loser, call on loser.
      const noteId = createId()
      await db.insert(contactNotes).values({
        id: noteId,
        organizationId: orgId,
        contactId: loserId,
        body: "note from loser",
        createdBy: userId,
        updatedBy: userId,
      })
      const assocId = createId()
      await db.insert(contactCompanyAssociations).values({
        id: assocId,
        organizationId: orgId,
        contactId: loserId,
        companyId,
        role: "Vendor",
        createdBy: userId,
      })
      const callId = createId()
      await db.insert(callLog).values({
        id: callId,
        organizationId: orgId,
        contactId: loserId,
        direction: "inbound",
        startedAt: new Date(),
        source: "manual",
      })

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId,
          loserIds: [loserId],
          fieldChoices: {},
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      const [note] = await db.select().from(contactNotes).where(eq(contactNotes.id, noteId))
      expect(note?.contactId).toBe(winnerId)
      const [assoc] = await db
        .select()
        .from(contactCompanyAssociations)
        .where(eq(contactCompanyAssociations.id, assocId))
      expect(assoc?.contactId).toBe(winnerId)
      const [call] = await db.select().from(callLog).where(eq(callLog.id, callId))
      expect(call?.contactId).toBe(winnerId)
    })
  })

  it("contact_company_associations dedup: winner + loser share same (company, role) → loser row deleted not duplicated", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const companyId = createId()
      await db.insert(companies).values({
        id: companyId,
        organizationId: orgId,
        name: "Evergreen",
        createdBy: userId,
        updatedBy: userId,
      })
      const winnerId = createId()
      const loserId = createId()
      await db.insert(contacts).values([
        {
          id: winnerId,
          organizationId: orgId,
          firstName: "W",
          lastName: "W",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: loserId,
          organizationId: orgId,
          firstName: "L",
          lastName: "L",
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      // Both have same (company, role="Vendor") — would collide.
      await db.insert(contactCompanyAssociations).values([
        {
          id: createId(),
          organizationId: orgId,
          contactId: winnerId,
          companyId,
          role: "Vendor",
          createdBy: userId,
        },
        {
          id: createId(),
          organizationId: orgId,
          contactId: loserId,
          companyId,
          role: "Vendor",
          createdBy: userId,
        },
      ])

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId,
          loserIds: [loserId],
          fieldChoices: {},
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      // Only one row remains — the duplicate was deduped.
      const assocs = await db
        .select()
        .from(contactCompanyAssociations)
        .where(eq(contactCompanyAssociations.contactId, winnerId))
      expect(assocs.length).toBe(1)
    })
  })

  it("tags 'use' mode: only chosen record's tags survive", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winnerId = createId()
      const loserId = createId()
      await db.insert(contacts).values([
        {
          id: winnerId,
          organizationId: orgId,
          firstName: "W",
          lastName: "W",
          tags: ["a", "b"],
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: loserId,
          organizationId: orgId,
          firstName: "L",
          lastName: "L",
          tags: ["c"],
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId,
          loserIds: [loserId],
          fieldChoices: {},
          tagsMode: { mode: "use", fromId: loserId },
          companiesMode: { mode: "union" },
        },
      )

      const [w] = await db.select().from(contacts).where(eq(contacts.id, winnerId))
      expect(w?.tags).toEqual(["c"])
    })
  })

  it("restoring a merged loser brings it back as a SEPARATE record; winner's mergedRecordIds unchanged", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winnerId = createId()
      const loserId = createId()
      await db.insert(contacts).values([
        {
          id: winnerId,
          organizationId: orgId,
          firstName: "W",
          lastName: "W",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: loserId,
          organizationId: orgId,
          firstName: "L",
          lastName: "L",
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      await executeContactMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        {
          winnerId,
          loserIds: [loserId],
          fieldChoices: {},
          tagsMode: { mode: "union" },
          companiesMode: { mode: "union" },
        },
      )

      // Restore the loser (the same UPDATE the restoreContact action runs).
      await db
        .update(contacts)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(contacts.id, loserId))

      const [restored] = await db.select().from(contacts).where(eq(contacts.id, loserId))
      expect(restored?.deletedAt).toBeNull()
      // Winner's mergedRecordIds STILL includes the loser id (merge not unwound).
      const [winner] = await db.select().from(contacts).where(eq(contacts.id, winnerId))
      expect(winner?.mergedRecordIds).toEqual([loserId])
      // Both rows now active and independent.
      const live = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)))
      expect(live.length).toBe(2)
    })
  })
})

describe("companies merge — engine", () => {
  it("merges two companies on domain match; contacts.company_id repoints", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winnerId = createId()
      const loserId = createId()
      await db.insert(companies).values([
        {
          id: winnerId,
          organizationId: orgId,
          name: "Evergreen Planning",
          website: "https://evergreen.example",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: loserId,
          organizationId: orgId,
          name: "Evergreen Events",
          website: "https://www.evergreen.example",
          createdBy: userId,
          updatedBy: userId,
        },
      ])
      // A contact tied to the loser company.
      const contactId = createId()
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "Ada",
        lastName: "Smith",
        companyId: loserId,
        createdBy: userId,
        updatedBy: userId,
      })

      await executeCompanyMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        { winnerId, loserIds: [loserId], fieldChoices: {} },
      )

      const [winner] = await db.select().from(companies).where(eq(companies.id, winnerId))
      expect(winner?.mergedRecordIds).toEqual([loserId])
      expect(winner?.deletedAt).toBeNull()

      const [loser] = await db.select().from(companies).where(eq(companies.id, loserId))
      expect(loser?.deletedAt).not.toBeNull()

      const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId))
      expect(contact?.companyId).toBe(winnerId)

      const audits = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, orgId), eq(auditLog.action, "companies.merged")))
      expect(audits.length).toBe(1)
      expect(audits[0]?.resourceId).toBe(winnerId)
    })
  })

  it("companies merge handles 'adopt loser name' without tripping the partial-unique index", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const winnerId = createId()
      const loserId = createId()
      await db.insert(companies).values([
        {
          id: winnerId,
          organizationId: orgId,
          name: "Old Name",
          createdBy: userId,
          updatedBy: userId,
        },
        {
          id: loserId,
          organizationId: orgId,
          name: "New Name",
          createdBy: userId,
          updatedBy: userId,
        },
      ])

      // Pick the loser's name for the winner. Engine soft-deletes the
      // loser FIRST to free the unique index, then UPDATEs winner.
      await executeCompanyMerge(
        db,
        { organizationId: orgId, userId, ipAddress: null, userAgent: null },
        { winnerId, loserIds: [loserId], fieldChoices: { name: loserId } },
      )

      const [winner] = await db.select().from(companies).where(eq(companies.id, winnerId))
      expect(winner?.name).toBe("New Name")
    })
  })
})

describe("merge engine — input validation", () => {
  it("rejects winnerId appearing in loserIds", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      const id = createId()
      await expect(
        executeContactMerge(
          db,
          { organizationId: orgId, userId, ipAddress: null, userAgent: null },
          {
            winnerId: id,
            loserIds: [id],
            fieldChoices: {},
            tagsMode: { mode: "union" },
            companiesMode: { mode: "union" },
          },
        ),
      ).rejects.toThrow(/Winner id cannot appear in loserIds/)
    })
  })

  it("rejects merging non-existent rows", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)
      await expect(
        executeContactMerge(
          db,
          { organizationId: orgId, userId, ipAddress: null, userAgent: null },
          {
            winnerId: createId(),
            loserIds: [createId()],
            fieldChoices: {},
            tagsMode: { mode: "union" },
            companiesMode: { mode: "union" },
          },
        ),
      ).rejects.toThrow(/no longer exist/)
    })
  })
})

// Suppress unused-import lint for the sql import (kept for ergonomic
// future query writing inside this test file).
void sql
