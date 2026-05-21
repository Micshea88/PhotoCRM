/**
 * Integration tests for the default-saved-views seed (Team This Week).
 *
 * These cover:
 *   - Seed creates the Team This Week row with the documented config
 *   - Seed is idempotent (running twice produces one row)
 *   - Row has the immutability shape: owner_user_id=NULL, shared=true,
 *     is_default=true
 *   - The owner-only mutation rule means no one can edit/delete it
 *     (verified via direct check of `ownerUserId` field — the
 *     assertOwnsSavedView helper compares strictly with `!==`)
 */
import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { savedViews } from "@/modules/saved-views/schema"
import { seedDefaultSavedViewsForOrg } from "@/modules/saved-views/seed"

describe("seedDefaultSavedViewsForOrg — Team This Week", () => {
  it("seeds the Team This Week view with the documented config", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      await seedDefaultSavedViewsForOrg(db, orgId)

      // Filter to the task view specifically since the seed now ships
      // multiple default views (added "All Contacts" in P4.2).
      const rows = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.organizationId, orgId),
            eq(savedViews.objectType, "task"),
            isNull(savedViews.deletedAt),
          ),
        )
      expect(rows.length).toBe(1)
      const view = rows[0]!
      expect(view.objectType).toBe("task")
      expect(view.name).toBe("Team This Week")
      expect(view.ownerUserId).toBeNull()
      expect(view.shared).toBe(true)
      expect(view.isDefault).toBe(true)
      expect(view.grouping).toBe("assigneeUserId")
      expect(view.visibleColumns).toEqual([
        "assigneeUserId",
        "title",
        "dueDate",
        "status",
        "priority",
      ])
      // Date-window placeholders (renderer resolves at render time).
      expect(view.filters).toEqual([
        { field: "dueDate", op: "gte", value: "<startOfWeek>" },
        { field: "dueDate", op: "lte", value: "<endOfWeek>" },
      ])
      expect(view.sort).toEqual({ field: "dueDate", direction: "asc" })
    })
  })

  it("is idempotent — running twice produces exactly one Team This Week row", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      await seedDefaultSavedViewsForOrg(db, orgId)
      await seedDefaultSavedViewsForOrg(db, orgId)
      await seedDefaultSavedViewsForOrg(db, orgId)

      const rows = await db
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(
          and(
            eq(savedViews.organizationId, orgId),
            eq(savedViews.name, "Team This Week"),
            isNull(savedViews.deletedAt),
          ),
        )
      expect(rows.length).toBe(1)
    })
  })

  it("the seeded row is immutable — assertOwnsSavedView's `!==` rejects every requester", async () => {
    // This is a property of the design (NULL owner_user_id ≠ any user id)
    // rather than a runtime check, but we verify here that the stored
    // owner_user_id IS null. The owner-only enforcement in actions.ts
    // does `if (row.ownerUserId !== userId)` — null !== "any-uuid" is
    // true, so it throws FORBIDDEN.
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)
      await seedDefaultSavedViewsForOrg(db, orgId)

      const [view] = await db
        .select({ ownerUserId: savedViews.ownerUserId })
        .from(savedViews)
        .where(eq(savedViews.organizationId, orgId))
      expect(view?.ownerUserId).toBeNull()
      // The strict-!== check in actions.ts:55 means `null !== userId` for
      // every real user id — FORBIDDEN is the only possible mutation outcome.
      expect(view?.ownerUserId !== userId).toBe(true)
    })
  })

  it("scopes per-org — two orgs each get their own Team This Week", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgA = await createOrganization(db, userA)
      const orgB = await createOrganization(db, userB)

      await setOrgContext(db, orgA)
      await seedDefaultSavedViewsForOrg(db, orgA)
      await setOrgContext(db, orgB)
      await seedDefaultSavedViewsForOrg(db, orgB)

      // Each org sees exactly one Team This Week — RLS scopes the read.
      await setOrgContext(db, orgA)
      const aRows = await db
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(eq(savedViews.name, "Team This Week"))
      expect(aRows.length).toBe(1)

      await setOrgContext(db, orgB)
      const bRows = await db
        .select({ id: savedViews.id })
        .from(savedViews)
        .where(eq(savedViews.name, "Team This Week"))
      expect(bRows.length).toBe(1)

      // The two rows have distinct ids.
      expect(aRows[0]!.id).not.toBe(bRows[0]!.id)
    })
  })
})
