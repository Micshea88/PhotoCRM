import { describe, it, expect } from "vitest"
import { and, eq, isNull, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { customFieldDefinitions } from "@/modules/custom-fields/schema"
import { savedViews } from "@/modules/saved-views/schema"
import { prepareCustomFieldsForCreate } from "@/modules/custom-fields/host-helpers"

/**
 * Push 4 (A4) — pins the saved-views + contacts list custom-field
 * integration:
 *
 *   1. Saved-view jsonb shape stays additive — a column_config row
 *      with a `cf:<fieldId>` column id and a filters row with a
 *      `field: "customField.<fieldId>"` entry round-trip into the
 *      jsonb columns and back.
 *
 *   2. The JSONB GIN index ships on contacts.custom_fields so the
 *      list page's per-field filters have an index to lean on.
 *
 *   3. CSV-import-style write: the prepareCustomFieldsForCreate
 *      helper (used by the import action when the user mapped a
 *      cf:* column) lands the value on the contact's
 *      custom_fields jsonb.
 *
 * These together give us "save a view with cf column + filter → it
 * reloads with the same state" without needing E2E cookies.
 */

describe("Push 4 A4 — contacts list custom fields integration", () => {
  it("saved-view column_config + filters round-trip with cf:<id> and customField.<id>", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const defId = createId()
      await db.insert(customFieldDefinitions).values({
        id: defId,
        organizationId: orgId,
        recordType: "contact",
        name: "Pet Allergies",
        fieldType: "text",
        order: 0,
        required: false,
      })

      const viewId = createId()
      await db.insert(savedViews).values({
        id: viewId,
        organizationId: orgId,
        objectType: "contact",
        name: "Test View",
        ownerUserId: userId,
        visibility: "private",
        filters: [
          {
            field: `customField.${defId}`,
            op: "contains",
            value: "peanuts",
          },
        ],
        columnConfig: [
          { id: "firstName", visible: true, order: 0, width: null },
          { id: `cf:${defId}`, visible: true, order: 1, width: 200 },
        ],
        createdBy: userId,
        updatedBy: userId,
      })

      const [row] = await db.select().from(savedViews).where(eq(savedViews.id, viewId))
      expect(row?.filters).toEqual([
        { field: `customField.${defId}`, op: "contains", value: "peanuts" },
      ])
      const cfg = row?.columnConfig
      expect(cfg).toBeDefined()
      const cfCol = cfg?.find((c) => c.id === `cf:${defId}`)
      expect(cfCol).toMatchObject({ id: `cf:${defId}`, visible: true, order: 1, width: 200 })
    })
  })

  it("GIN index on contacts.custom_fields exists after the A4 migration", async () => {
    await withTestDb(async (db) => {
      const result = await db.execute<{ indexname: string }>(sql`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'contacts' AND indexname = 'contacts_custom_fields_gin_idx'
      `)
      expect(result.rows.length).toBe(1)
    })
  })

  it("GIN indexes ship for companies / opportunities / projects too (entity-agnostic engine)", async () => {
    await withTestDb(async (db) => {
      const result = await db.execute<{ tablename: string; indexname: string }>(sql`
        SELECT tablename, indexname
        FROM pg_indexes
        WHERE indexname IN (
          'companies_custom_fields_gin_idx',
          'opportunities_custom_fields_gin_idx',
          'projects_custom_fields_gin_idx'
        )
        ORDER BY indexname
      `)
      expect(result.rows.length).toBe(3)
    })
  })

  it("CSV-import write path persists custom_fields jsonb on the contact row", async () => {
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

      const { value: typedCustom } = await prepareCustomFieldsForCreate(db, "contact", {
        [defId]: "peanuts",
      })

      const contactId = createId()
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "Imported",
        lastName: "Person",
        customFields: typedCustom,
        createdBy: userId,
        updatedBy: userId,
      })

      const [row] = await db
        .select({ customFields: contacts.customFields })
        .from(contacts)
        .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)))
      expect(row?.customFields).toEqual({ [defId]: "peanuts" })
    })
  })

  it("loading a saved view with an archived custom field keeps the column entry intact", async () => {
    // Mirrors Mike's "(archived)" suffix scenario: the saved-view
    // jsonb row keeps `cf:<id>` even after the def is archived, so
    // the UI can render it with the suffix and offer a remove.
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const defId = createId()
      await db.insert(customFieldDefinitions).values({
        id: defId,
        organizationId: orgId,
        recordType: "contact",
        name: "Old Stuff",
        fieldType: "text",
        order: 0,
        required: false,
      })

      const viewId = createId()
      await db.insert(savedViews).values({
        id: viewId,
        organizationId: orgId,
        objectType: "contact",
        name: "Archived col view",
        ownerUserId: userId,
        visibility: "private",
        columnConfig: [{ id: `cf:${defId}`, visible: true, order: 0, width: null }],
        createdBy: userId,
        updatedBy: userId,
      })

      // Archive the definition.
      await db
        .update(customFieldDefinitions)
        .set({ archivedAt: new Date(), archivedBy: userId })
        .where(eq(customFieldDefinitions.id, defId))

      const [view] = await db.select().from(savedViews).where(eq(savedViews.id, viewId))
      expect(view?.columnConfig[0]?.id).toBe(`cf:${defId}`)

      const [defRow] = await db
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.id, defId))
      expect(defRow?.archivedAt).not.toBeNull()
    })
  })
})
