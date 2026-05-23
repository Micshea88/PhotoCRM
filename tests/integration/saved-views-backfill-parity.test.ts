/**
 * Drift guard: `seedDefaultSavedViewsForOrg` and migration 0025's
 * "All Contacts" backfill MUST produce the same row shape.
 *
 * If anyone changes the seed's column list, order, visibility, sort, or
 * filter spec, this test fails — they have to update both the migration
 * AND the literal below.
 *
 * The literal is deliberately INLINED here (not imported from the seed)
 * so it tracks with the migration's hardcoded SQL constants. The seed
 * is the System Under Test; the literal is the reference shape that
 * migration 0025 also builds.
 */

import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { savedViews } from "@/modules/saved-views/schema"
import { seedDefaultSavedViewsForOrg } from "@/modules/saved-views/seed"

const EXPECTED_ALL_CONTACTS_COLUMN_CONFIG = [
  { id: "displayLabel", visible: true, order: 0, width: null },
  { id: "primaryEmail", visible: true, order: 1, width: null },
  { id: "primaryPhone", visible: true, order: 2, width: null },
  { id: "contactType", visible: true, order: 3, width: null },
  { id: "lifecycleStatus", visible: true, order: 4, width: null },
  { id: "tags", visible: true, order: 5, width: null },
]

describe("All Contacts default — seed/migration drift guard", () => {
  it("seedDefaultSavedViewsForOrg produces the row shape migration 0025 reconstructs", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await seedDefaultSavedViewsForOrg(db, orgId)

      const [row] = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.organizationId, orgId),
            eq(savedViews.objectType, "contact"),
            eq(savedViews.name, "All Contacts"),
            eq(savedViews.isDefault, true),
            isNull(savedViews.ownerUserId),
          ),
        )
        .limit(1)

      expect(row).toBeTruthy()
      expect(row?.columnConfig).toEqual(EXPECTED_ALL_CONTACTS_COLUMN_CONFIG)
      expect(row?.visibility).toBe("org")
      expect(row?.filters).toEqual([])
      expect(row?.sort).toEqual({ field: "lastName", direction: "asc" })
      expect(row?.grouping).toBeNull()
      expect(row?.ownerUserId).toBeNull()
      expect(row?.isDefault).toBe(true)
    })
  })
})
