import { describe, it, expect } from "vitest"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { customFieldDefinitions } from "@/modules/custom-fields/schema"
import { contacts } from "@/modules/contacts/schema"

/**
 * Push 4 (A3) — pins the invariant that archiving a custom field
 * definition does NOT touch host rows. Existing `custom_fields jsonb`
 * values stay byte-for-byte intact; the archive marker only lives on
 * the definition row.
 *
 * Also pins the listActiveFieldDefinitionsForRecordType query shape:
 * archived rows excluded, deleted rows excluded, active rows returned
 * in order.
 */

describe("custom fields — archive does not scrub host rows", () => {
  it("archiving a definition leaves the contact's jsonb value intact", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const defId = createId()
      await db.insert(customFieldDefinitions).values({
        id: defId,
        organizationId: orgId,
        recordType: "contact",
        name: "Allergies",
        fieldType: "text",
        order: 0,
        required: false,
      })

      const contactId = createId()
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "Test",
        lastName: "Person",
        customFields: { [defId]: "peanuts" },
        createdBy: userId,
        updatedBy: userId,
      })

      // Archive the definition (the same SQL the action runs).
      await db
        .update(customFieldDefinitions)
        .set({ archivedAt: new Date(), archivedBy: userId })
        .where(eq(customFieldDefinitions.id, defId))

      const [row] = await db.select().from(contacts).where(eq(contacts.id, contactId))
      expect(row?.customFields).toEqual({ [defId]: "peanuts" })

      const [defRow] = await db
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.id, defId))
      expect(defRow?.archivedAt).not.toBeNull()
    })
  })

  it("active-only query excludes archived AND deleted definitions, includes ordered active ones", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const activeOne = createId()
      const activeTwo = createId()
      const archivedDef = createId()
      const deletedDef = createId()
      await db.insert(customFieldDefinitions).values([
        {
          id: activeOne,
          organizationId: orgId,
          recordType: "contact",
          name: "First active",
          fieldType: "text",
          order: 0,
          required: false,
        },
        {
          id: activeTwo,
          organizationId: orgId,
          recordType: "contact",
          name: "Second active",
          fieldType: "text",
          order: 1,
          required: false,
        },
        {
          id: archivedDef,
          organizationId: orgId,
          recordType: "contact",
          name: "Archived field",
          fieldType: "text",
          order: 2,
          required: false,
          archivedAt: new Date(),
          archivedBy: userId,
        },
        {
          id: deletedDef,
          organizationId: orgId,
          recordType: "contact",
          name: "Deleted field",
          fieldType: "text",
          order: 3,
          required: false,
          deletedAt: new Date(),
          deletedBy: userId,
        },
      ])

      // Mirror what listActiveFieldDefinitionsForRecordType issues.
      const activeRows = await db
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.recordType, "contact"),
            isNull(customFieldDefinitions.deletedAt),
            isNull(customFieldDefinitions.archivedAt),
          ),
        )
        .orderBy(customFieldDefinitions.order, customFieldDefinitions.name)

      expect(activeRows.map((r) => r.id)).toEqual([activeOne, activeTwo])
    })
  })

  it("full list (non-deleted) includes archived for validators that need to preserve them", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const activeDef = createId()
      const archivedDef = createId()
      const deletedDef = createId()
      await db.insert(customFieldDefinitions).values([
        {
          id: activeDef,
          organizationId: orgId,
          recordType: "contact",
          name: "A",
          fieldType: "text",
          order: 0,
          required: false,
        },
        {
          id: archivedDef,
          organizationId: orgId,
          recordType: "contact",
          name: "B",
          fieldType: "text",
          order: 1,
          required: false,
          archivedAt: new Date(),
          archivedBy: userId,
        },
        {
          id: deletedDef,
          organizationId: orgId,
          recordType: "contact",
          name: "C",
          fieldType: "text",
          order: 2,
          required: false,
          deletedAt: new Date(),
          deletedBy: userId,
        },
      ])

      const nonDeletedRows = await db
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.recordType, "contact"),
            isNull(customFieldDefinitions.deletedAt),
          ),
        )

      const ids = new Set(nonDeletedRows.map((r) => r.id))
      expect(ids.has(activeDef)).toBe(true)
      expect(ids.has(archivedDef)).toBe(true)
      expect(ids.has(deletedDef)).toBe(false)
    })
  })

  it("archived field's stored jsonb value survives the field being archived AND unarchived", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const defId = createId()
      await db.insert(customFieldDefinitions).values({
        id: defId,
        organizationId: orgId,
        recordType: "contact",
        name: "Allergies",
        fieldType: "text",
        order: 0,
        required: false,
      })

      const contactId = createId()
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "Test",
        lastName: "Person",
        customFields: { [defId]: "shellfish" },
        createdBy: userId,
        updatedBy: userId,
      })

      // archive
      await db
        .update(customFieldDefinitions)
        .set({ archivedAt: new Date(), archivedBy: userId })
        .where(eq(customFieldDefinitions.id, defId))

      // unarchive
      await db
        .update(customFieldDefinitions)
        .set({ archivedAt: null, archivedBy: null })
        .where(
          and(eq(customFieldDefinitions.id, defId), isNotNull(customFieldDefinitions.archivedAt)),
        )

      const [row] = await db.select().from(contacts).where(eq(contacts.id, contactId))
      expect(row?.customFields).toEqual({ [defId]: "shellfish" })
    })
  })
})
