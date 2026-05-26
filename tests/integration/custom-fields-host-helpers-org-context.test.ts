import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { customFieldDefinitions } from "@/modules/custom-fields/schema"
import {
  prepareCustomFieldsForCreate,
  prepareCustomFieldsForUpdate,
} from "@/modules/custom-fields/host-helpers"

/**
 * Push 4 (A3 hotfix) — pins the contract that the host helpers read
 * the org context off the passed-in `db` transaction, NOT from
 * AsyncLocalStorage.
 *
 * The pre-hotfix helpers called `withOrgContext(...)` internally,
 * which throws when ALS is empty — and `orgAction` doesn't populate
 * ALS, only pg session settings on its transaction. The bug surfaced
 * only when the create/update payload contained a custom_fields
 * value (the helpers short-circuit on empty payloads), which is why
 * the unit + integration tests in A3 didn't catch it.
 *
 * This test mirrors the orgAction setup deliberately:
 *   - opens a transaction (withTestDb)
 *   - sets the same pg-local settings orgAction sets (setOrgContext)
 *   - does NOT wrap in runWithOrgContext
 *   - then calls the helpers
 *
 * If the helpers regress to ALS-based queries, this test catches it.
 */

describe("custom-fields host helpers — org context propagation", () => {
  it("prepareCustomFieldsForCreate works inside an orgAction-style tx (pg settings only, no ALS)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      // orgAction does this; we do NOT wrap in runWithOrgContext.
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

      const { value } = await prepareCustomFieldsForCreate(db, "contact", {
        [defId]: "peanuts",
      })
      expect(value).toEqual({ [defId]: "peanuts" })
    })
  })

  it("prepareCustomFieldsForCreate silently drops keys for archived defs (pg-only context)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const activeId = createId()
      const archivedId = createId()
      await db.insert(customFieldDefinitions).values([
        {
          id: activeId,
          organizationId: orgId,
          recordType: "contact",
          name: "Active",
          fieldType: "text",
          order: 0,
          required: false,
        },
        {
          id: archivedId,
          organizationId: orgId,
          recordType: "contact",
          name: "OldField",
          fieldType: "text",
          order: 1,
          required: false,
          archivedAt: new Date(),
          archivedBy: userId,
        },
      ])

      const { value } = await prepareCustomFieldsForCreate(db, "contact", {
        [activeId]: "alpha",
        [archivedId]: "dropped",
      })
      expect(value).toEqual({ [activeId]: "alpha" })
    })
  })

  it("prepareCustomFieldsForUpdate refuses archived keys with friendly error (pg-only context)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const archivedId = createId()
      await db.insert(customFieldDefinitions).values({
        id: archivedId,
        organizationId: orgId,
        recordType: "contact",
        name: "Discontinued",
        fieldType: "text",
        order: 0,
        required: false,
        archivedAt: new Date(),
        archivedBy: userId,
      })

      await expect(
        prepareCustomFieldsForUpdate(
          db,
          "contact",
          { [archivedId]: "old" },
          { [archivedId]: "new" },
        ),
      ).rejects.toThrow(/archived/i)
    })
  })

  it("prepareCustomFieldsForUpdate preserves archived existing values when payload only carries active keys", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const activeId = createId()
      const archivedId = createId()
      await db.insert(customFieldDefinitions).values([
        {
          id: activeId,
          organizationId: orgId,
          recordType: "contact",
          name: "Active",
          fieldType: "text",
          order: 0,
          required: false,
        },
        {
          id: archivedId,
          organizationId: orgId,
          recordType: "contact",
          name: "Archived",
          fieldType: "text",
          order: 1,
          required: false,
          archivedAt: new Date(),
          archivedBy: userId,
        },
      ])

      const existing = { [activeId]: "old", [archivedId]: "frozen" }
      const incoming = { [activeId]: "new" }

      const { value, changes } = await prepareCustomFieldsForUpdate(
        db,
        "contact",
        existing,
        incoming,
      )
      expect(value).toEqual({ [activeId]: "new", [archivedId]: "frozen" })
      expect(changes).toHaveLength(1)
      expect(changes[0]?.fieldId).toBe(activeId)
    })
  })

  it("works the same for company / opportunity / project record types", async () => {
    // Confirms the helper composition is record-type agnostic at the
    // org-context propagation layer (which was the buggy bit). Per-type
    // validation is unit-tested elsewhere.
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      for (const recordType of ["company", "opportunity", "project"] as const) {
        const defId = createId()
        await db.insert(customFieldDefinitions).values({
          id: defId,
          organizationId: orgId,
          recordType,
          name: `${recordType} field`,
          fieldType: "text",
          order: 0,
          required: false,
        })
        const { value } = await prepareCustomFieldsForCreate(db, recordType, {
          [defId]: "v",
        })
        expect(value).toEqual({ [defId]: "v" })
      }
    })
  })
})
