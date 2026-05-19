import { describe, it, expect } from "vitest"
import { and, eq, isNull, or } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { savedViews } from "@/modules/saved-views/schema"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"

describe("saved-views module — db-level invariants", () => {
  it("creates a view with jsonb filters/sort/visibleColumns + audit row", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId)

      const id = createId()
      await db.insert(savedViews).values({
        id,
        organizationId: orgId,
        objectType: "contact",
        name: "Vendor Matrix",
        ownerUserId: userId,
        shared: true,
        filters: [{ field: "contactType", op: "eq", value: "Vendor" }],
        sort: { field: "lastName", direction: "asc" },
        visibleColumns: ["firstName", "lastName", "company", "category"],
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
      expect(row?.shared).toBe(true)
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
      await setOrgContext(db, orgId)

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
      await setOrgContext(db, orgId)

      // Both users create a view named "My VIPs" — both succeed.
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "My VIPs",
        ownerUserId: userA,
        createdBy: userA,
        updatedBy: userA,
      })
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "My VIPs",
        ownerUserId: userB,
        createdBy: userB,
        updatedBy: userB,
      })
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
      await setOrgContext(db, orgId)

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

  it("owner-or-shared visibility filter matches the action-layer rule", async () => {
    await withTestDb(async (db) => {
      const userA = await createUser(db)
      const userB = await createUser(db)
      const orgId = await createOrganization(db, userA)
      await setOrgContext(db, orgId)

      // userA creates: one private, one shared.
      await db.insert(savedViews).values([
        {
          id: createId(),
          organizationId: orgId,
          objectType: "contact",
          name: "A private",
          ownerUserId: userA,
          shared: false,
          createdBy: userA,
          updatedBy: userA,
        },
        {
          id: createId(),
          organizationId: orgId,
          objectType: "contact",
          name: "A shared",
          ownerUserId: userA,
          shared: true,
          createdBy: userA,
          updatedBy: userA,
        },
      ])
      // userB creates one private.
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "B private",
        ownerUserId: userB,
        shared: false,
        createdBy: userB,
        updatedBy: userB,
      })

      // userB should see: their own "B private" + userA's shared "A shared". NOT "A private".
      const visibleToB = await db
        .select({ name: savedViews.name })
        .from(savedViews)
        .where(
          and(
            eq(savedViews.organizationId, orgId),
            isNull(savedViews.deletedAt),
            or(eq(savedViews.ownerUserId, userB), eq(savedViews.shared, true)),
          ),
        )
        .orderBy(savedViews.name)
      const names = visibleToB.map((v) => v.name)
      expect(names).toContain("B private")
      expect(names).toContain("A shared")
      expect(names).not.toContain("A private")
    })
  })
})
