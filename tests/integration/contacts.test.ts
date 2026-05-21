import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { companies } from "@/modules/companies/schema"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"
import { contactLabel } from "@/modules/contacts/display"

/**
 * Behavioural tests for the contacts module's db-level invariants +
 * the contactLabel display helper. Tests connect as pathway_app
 * (RLS-subject) and use setOrgContext.
 *
 * Cross-org isolation (RLS enforcement) is covered separately by
 * contacts-rls.test.ts via raw pg with the app layer bypassed.
 */

describe("contacts module — db-level invariants", () => {
  it("creates a contact with all the fields and writes an audit row", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const companyId = createId()
      await db.insert(companies).values({
        id: companyId,
        organizationId: orgId,
        name: "Evergreen Planning",
        website: "https://evergreen.example",
        createdBy: userId,
        updatedBy: userId,
      })

      const contactId = createId()
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "Kelly",
        lastName: "Smith",
        companyId,
        primaryEmail: "kelly@evergreen.example",
        primaryPhone: "+1 555 123 4567",
        contactType: "Vendor",
        lifecycleStatus: "Active",
        tags: ["vip", "planner"],
        ownerUserId: userId,
        customFields: { yearsActive: 8 },
        createdBy: userId,
        updatedBy: userId,
      })

      await audit(
        {
          db,
          organizationId: orgId,
          actorUserId: userId,
          ipAddress: "127.0.0.1",
          userAgent: "vitest",
        },
        "contacts.created",
        { resourceType: "contact", resourceId: contactId },
      )

      const rows = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)))
      expect(rows.length).toBe(1)
      const row = rows[0]!
      expect(row.firstName).toBe("Kelly")
      expect(row.lastName).toBe("Smith")
      expect(row.contactType).toBe("Vendor")
      expect(row.tags).toEqual(["vip", "planner"])
      expect(row.customFields).toEqual({ yearsActive: 8 })

      const audits = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgId))
      expect(audits.length).toBe(1)
      expect(audits[0]?.action).toBe("contacts.created")
    })
  })

  it("soft-delete + restore round-trip", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const contactId = createId()
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "Pat",
        lastName: "Lee",
        createdBy: userId,
        updatedBy: userId,
      })

      await db
        .update(contacts)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(contacts.id, contactId))

      const visible = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)))
      expect(visible.length).toBe(0)

      await db
        .update(contacts)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(contacts.id, contactId))

      const restored = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)))
      expect(restored.length).toBe(1)
    })
  })

  it("referred_by_contact_id is self-referential and ON DELETE SET NULL", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const referrerId = createId()
      const referredId = createId()

      await db.insert(contacts).values({
        id: referrerId,
        organizationId: orgId,
        firstName: "Referring",
        lastName: "Person",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(contacts).values({
        id: referredId,
        organizationId: orgId,
        firstName: "Referred",
        lastName: "Person",
        referredByContactId: referrerId,
        createdBy: userId,
        updatedBy: userId,
      })

      const [row] = await db
        .select({ ref: contacts.referredByContactId })
        .from(contacts)
        .where(eq(contacts.id, referredId))
      expect(row?.ref).toBe(referrerId)

      // Hard-delete the referrer (simulates the purge cron). ON DELETE
      // SET NULL means the referral pointer goes null, the referred
      // contact survives.
      await db.delete(contacts).where(eq(contacts.id, referrerId))
      const [after] = await db
        .select({ ref: contacts.referredByContactId })
        .from(contacts)
        .where(eq(contacts.id, referredId))
      expect(after?.ref).toBeNull()
    })
  })
})

describe("contactLabel display helper", () => {
  // Output format updated 2026-05-21 from "Last, First — Company" to
  // "First Last — Company" per PIVOTS_LEDGER LOC1 (natural reading
  // order; same display rule, simpler phrasing).
  it("formats with company when present", () => {
    expect(contactLabel({ firstName: "Kelly", lastName: "Smith" }, "Evergreen Planning")).toBe(
      "Kelly Smith — Evergreen Planning",
    )
  })

  it("falls back to email when no company", () => {
    expect(
      contactLabel({
        firstName: "Kelly",
        lastName: "Smith",
        primaryEmail: "kelly@example.com",
      }),
    ).toBe("Kelly Smith — kelly@example.com")
  })

  it("returns just the name when neither company nor email", () => {
    expect(contactLabel({ firstName: "Kelly", lastName: "Smith" })).toBe("Kelly Smith")
  })

  it("handles missing first name", () => {
    expect(contactLabel({ firstName: null, lastName: "Smith" }, "Evergreen")).toBe(
      "Smith — Evergreen",
    )
  })

  it("ignores empty-string companyName", () => {
    expect(
      contactLabel(
        { firstName: "Kelly", lastName: "Smith", primaryEmail: "kelly@example.com" },
        "   ",
      ),
    ).toBe("Kelly Smith — kelly@example.com")
  })

  it("falls back to '(unknown contact)' when both names absent", () => {
    expect(contactLabel({ firstName: null, lastName: null })).toBe("(unknown contact)")
  })
})
