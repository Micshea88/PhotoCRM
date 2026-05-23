/**
 * Push 2b — contacts filter-spec integration tests.
 *
 * Covers SQL behavior for the new contact filter shapes (hasPhone,
 * custom-fields contains, last-activity range). The 8-cap / ordered-
 * view-ids tests that originally lived here moved out in Push 2c:
 *   - 8-cap removed (unlimited saved views; only pinned tabs are capped)
 *   - ordered_view_ids → pinned_view_ids (see saved-views-push-2c.test.ts)
 *
 * Per the repo convention (see dashboard-queries.test.ts header), tests
 * inline SQL instead of calling the query helpers — the helpers open
 * their own transaction via the global db pool, which would bypass the
 * test's BEGIN/ROLLBACK envelope.
 */

import { describe, it, expect } from "vitest"
import { and, eq, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"

describe("contacts — Push 2b filter SQL shapes", () => {
  it("hasPhone — IS NOT NULL AND NULLIF != '' returns rows with non-empty phone", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await db.insert(contacts).values([
        {
          id: createId(),
          organizationId: orgId,
          firstName: "WithPhone",
          lastName: "A",
          primaryPhone: "5551234567",
        },
        {
          id: createId(),
          organizationId: orgId,
          firstName: "NoPhone",
          lastName: "B",
          primaryPhone: null,
        },
      ])

      const rows = await db
        .select({ firstName: contacts.firstName })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, orgId),
            sql`${contacts.primaryPhone} IS NOT NULL`,
            sql`NULLIF(${contacts.primaryPhone}, '') IS NOT NULL`,
          ),
        )
      expect(rows.map((r) => r.firstName)).toEqual(["WithPhone"])
    })
  })

  it("custom-fields jsonb ->> field ILIKE matches case-insensitively", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const fieldId = "cf_test_1"
      await db.insert(contacts).values([
        {
          id: createId(),
          organizationId: orgId,
          firstName: "Match",
          lastName: "Test",
          customFields: { [fieldId]: "Hello WORLD" },
        },
        {
          id: createId(),
          organizationId: orgId,
          firstName: "NoMatch",
          lastName: "Other",
          customFields: { [fieldId]: "nothing here" },
        },
      ])

      const rows = await db
        .select({ firstName: contacts.firstName })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, orgId),
            sql`${contacts.customFields} ->> ${fieldId} ILIKE ${"%world%"}`,
          ),
        )
      expect(rows.map((r) => r.firstName)).toEqual(["Match"])
    })
  })

  it("last-activity range uses updated_at as the proxy column", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const idA = createId()
      const idB = createId()
      await db.insert(contacts).values([
        {
          id: idA,
          organizationId: orgId,
          firstName: "OldA",
          lastName: "Activity",
        },
        {
          id: idB,
          organizationId: orgId,
          firstName: "NewB",
          lastName: "Activity",
        },
      ])
      // Backdate A to last year.
      await db.execute(
        sql`UPDATE contacts SET updated_at = NOW() - INTERVAL '400 days' WHERE id = ${idA}`,
      )

      const today = new Date().toISOString().slice(0, 10)
      const rows = await db
        .select({ firstName: contacts.firstName })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, orgId),
            sql`${contacts.updatedAt} >= (${today}::date - INTERVAL '30 days')`,
          ),
        )
      expect(rows.map((r) => r.firstName)).toContain("NewB")
      expect(rows.map((r) => r.firstName)).not.toContain("OldA")
    })
  })
})
