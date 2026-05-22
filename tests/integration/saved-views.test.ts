import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { savedViews } from "@/modules/saved-views/schema"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"

describe("saved-views module — db-level invariants", () => {
  it("creates a view with jsonb filters/sort/columnConfig + audit row", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id = createId()
      await db.insert(savedViews).values({
        id,
        organizationId: orgId,
        objectType: "contact",
        name: "Vendor Matrix",
        ownerUserId: userId,
        visibility: "org",
        filters: [{ field: "contactType", op: "eq", value: "Vendor" }],
        sort: { field: "lastName", direction: "asc" },
        columnConfig: [
          { id: "firstName", visible: true, order: 0, width: null },
          { id: "lastName", visible: true, order: 1, width: null },
          { id: "company", visible: true, order: 2, width: null },
          { id: "category", visible: true, order: 3, width: null },
        ],
        grouping: "category",
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
        "saved_views.created",
        { resourceType: "saved_view", resourceId: id },
      )

      const [row] = await db.select().from(savedViews).where(eq(savedViews.id, id))
      expect(row?.name).toBe("Vendor Matrix")
      expect(row?.visibility).toBe("org")
      expect(row?.filters).toEqual([{ field: "contactType", op: "eq", value: "Vendor" }])
      expect(row?.grouping).toBe("category")

      const audits = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgId))
      expect(audits.length).toBe(1)
    })
  })

  it("partial unique on (org, owner, object_type, name) blocks duplicate per user", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "My VIPs",
        ownerUserId: userId,
        createdBy: userId,
        updatedBy: userId,
      })
      await expect(
        db.insert(savedViews).values({
          id: createId(),
          organizationId: orgId,
          objectType: "contact",
          name: "My VIPs",
          ownerUserId: userId,
          createdBy: userId,
          updatedBy: userId,
        }),
      ).rejects.toThrow()
    })
  })

  it("partial unique is scoped to owner — different users can share a name", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId, "owner", userA)

      // Both users create an org-visible view named "My VIPs" — both
      // succeed; visibility=org means each user can see both rows
      // through the RLS SELECT policy.
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "My VIPs",
        ownerUserId: userA,
        visibility: "org",
        createdBy: userA,
        updatedBy: userA,
      })
      await setOrgContext(db, orgId, "owner", userB)
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "My VIPs",
        ownerUserId: userB,
        visibility: "org",
        createdBy: userB,
        updatedBy: userB,
      })
      // Reading as userA — both are visible because both are 'org'.
      await setOrgContext(db, orgId, "owner", userA)
      const rows = await db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.organizationId, orgId), eq(savedViews.name, "My VIPs")))
      expect(rows.length).toBe(2)
    })
  })

  it("partial unique allows recycle after soft-delete", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const firstId = createId()
      await db.insert(savedViews).values({
        id: firstId,
        organizationId: orgId,
        objectType: "contact",
        name: "Working set",
        ownerUserId: userId,
        createdBy: userId,
        updatedBy: userId,
      })
      // Soft-delete + recreate with same name.
      await db
        .update(savedViews)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(savedViews.id, firstId))
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "Working set",
        ownerUserId: userId,
        createdBy: userId,
        updatedBy: userId,
      })
      const live = await db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.organizationId, orgId), isNull(savedViews.deletedAt)))
      expect(live.length).toBe(1)
    })
  })

  it("3-tier visibility — RLS hides private views from non-owners but shows org + shared_users", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const userC = await createUser(db)
      const orgId = await createOrganization(db, userA)

      // userA creates: private + org + shared_users (with B)
      await setOrgContext(db, orgId, "owner", userA)
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "A private",
        ownerUserId: userA,
        visibility: "private",
        createdBy: userA,
        updatedBy: userA,
      })
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "A org",
        ownerUserId: userA,
        visibility: "org",
        createdBy: userA,
        updatedBy: userA,
      })
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "A shared with B",
        ownerUserId: userA,
        visibility: "shared_users",
        sharedWithUserIds: [userB],
        createdBy: userA,
        updatedBy: userA,
      })

      // RLS as userB — sees the org one + the shared-with-me one, not the private one.
      await setOrgContext(db, orgId, "owner", userB)
      const visibleToB = (
        await db
          .select({ name: savedViews.name })
          .from(savedViews)
          .where(eq(savedViews.organizationId, orgId))
      ).map((r) => r.name)
      expect(visibleToB).toContain("A org")
      expect(visibleToB).toContain("A shared with B")
      expect(visibleToB).not.toContain("A private")

      // RLS as userC — sees only the org one. Not in shared list.
      await setOrgContext(db, orgId, "owner", userC)
      const visibleToC = (
        await db
          .select({ name: savedViews.name })
          .from(savedViews)
          .where(eq(savedViews.organizationId, orgId))
      ).map((r) => r.name)
      expect(visibleToC).toContain("A org")
      expect(visibleToC).not.toContain("A shared with B")
      expect(visibleToC).not.toContain("A private")
    })
  })
})
