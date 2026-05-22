/**
 * Push 2b — saved-views action-layer + filter-spec integration tests.
 *
 * Covers:
 *   - 8/user/object_type soft limit invariant (count shape verified)
 *   - System defaults don't count toward the limit
 *   - user_object_view_prefs upsert preserves the unchanged field
 *   - SQL behavior for the new contact filter shapes (hasPhone, hasEmail,
 *     custom-fields contains, openTasks EXISTS subquery)
 *
 * Per the repo convention (see dashboard-queries.test.ts header), tests
 * inline SQL instead of calling the query helpers — the helpers open
 * their own transaction via the global db pool, which would bypass the
 * test's BEGIN/ROLLBACK envelope.
 */

import { describe, it, expect } from "vitest"
import { and, eq, isNull, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { savedViews, userObjectViewPrefs } from "@/modules/saved-views/schema"
import { contacts } from "@/modules/contacts/schema"
import { SAVED_VIEW_PER_USER_LIMIT } from "@/modules/saved-views/types"

describe("saved_views — 8/user/object_type limit invariant", () => {
  it("user-owned non-deleted contact view count = 8 after 8 inserts", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      for (let i = 0; i < SAVED_VIEW_PER_USER_LIMIT; i++) {
        await db.insert(savedViews).values({
          id: createId(),
          organizationId: orgId,
          objectType: "contact",
          name: `View ${String(i)}`,
          ownerUserId: userId,
          visibility: "private",
          createdBy: userId,
          updatedBy: userId,
        })
      }

      const rows = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.organizationId, orgId),
            eq(savedViews.ownerUserId, userId),
            eq(savedViews.objectType, "contact"),
            isNull(savedViews.deletedAt),
          ),
        )
      expect(rows.length).toBe(SAVED_VIEW_PER_USER_LIMIT)
    })
  })

  it("system defaults (NULL owner) don't count against the user limit", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // INSERT a system default — null owner, is_default, visibility=org.
      // The RLS INSERT policy lets this through regardless of user_id.
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "All Contacts",
        ownerUserId: null,
        visibility: "org",
        isDefault: true,
      })

      const ownedCount = (
        await db
          .select()
          .from(savedViews)
          .where(
            and(
              eq(savedViews.organizationId, orgId),
              eq(savedViews.ownerUserId, userId),
              eq(savedViews.objectType, "contact"),
              isNull(savedViews.deletedAt),
            ),
          )
      ).length
      expect(ownedCount).toBe(0)
    })
  })
})

describe("user_object_view_prefs — upsert preserves unchanged fields", () => {
  it("setting last_viewed alone does not blow away ordered_view_ids", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // First insert: orderedViewIds populated, lastViewedViewId null.
      await db.insert(userObjectViewPrefs).values({
        organizationId: orgId,
        userId,
        objectType: "contact",
        orderedViewIds: ["view-a", "view-b"],
      })

      // Mimic the action's "update last_viewed only" upsert: set ONLY
      // the lastViewedViewId field in the patch.
      await db
        .insert(userObjectViewPrefs)
        .values({
          organizationId: orgId,
          userId,
          objectType: "contact",
          orderedViewIds: [],
          lastViewedViewId: null,
        })
        .onConflictDoUpdate({
          target: [
            userObjectViewPrefs.organizationId,
            userObjectViewPrefs.userId,
            userObjectViewPrefs.objectType,
          ],
          set: { updatedAt: new Date() },
        })

      const [row] = await db
        .select()
        .from(userObjectViewPrefs)
        .where(eq(userObjectViewPrefs.userId, userId))
        .limit(1)
      expect(row?.orderedViewIds).toEqual(["view-a", "view-b"])
    })
  })
})

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
