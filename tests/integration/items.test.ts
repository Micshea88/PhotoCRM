import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { items } from "@/modules/items/schema"
import { auditLog } from "@/modules/audit/schema"
import { audit } from "@/modules/audit/audit"

// These tests exercise queries + the audit helper directly. The full safe-action
// path (auth + org middleware) is covered by E2E in Phase 10 since it requires
// session cookies and the route handlers to be live.

describe("items module — db-level invariants", () => {
  it("scopes items to a single organization", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgA = await createOrganization(db, userId)
      const orgB = await createOrganization(db, userId)

      await db.insert(items).values({
        id: createId(),
        organizationId: orgA,
        name: "Item in A",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(items).values({
        id: createId(),
        organizationId: orgB,
        name: "Item in B",
        createdBy: userId,
        updatedBy: userId,
      })

      const inA = await db
        .select()
        .from(items)
        .where(and(eq(items.organizationId, orgA), isNull(items.deletedAt)))

      expect(inA.length).toBe(1)
      expect(inA[0]?.name).toBe("Item in A")
    })
  })

  it("soft-deleted items are filtered by default queries", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      const itemId = createId()

      await db.insert(items).values({
        id: itemId,
        organizationId: orgId,
        name: "To delete",
        createdBy: userId,
        updatedBy: userId,
      })

      await db
        .update(items)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(items.id, itemId))

      // Query that respects soft-delete: should be empty
      const visible = await db
        .select()
        .from(items)
        .where(and(eq(items.organizationId, orgId), isNull(items.deletedAt)))
      expect(visible.length).toBe(0)

      // Query that includes deleted: still finds it
      const all = await db.select().from(items).where(eq(items.organizationId, orgId))
      expect(all.length).toBe(1)
    })
  })

  it("audit() writes a log row with org and actor", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)

      await audit(
        {
          db,
          organizationId: orgId,
          actorUserId: userId,
          ipAddress: "127.0.0.1",
          userAgent: "vitest",
        },
        "items.created",
        { resourceType: "item", resourceId: "abc123" },
      )

      const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgId))

      expect(rows.length).toBe(1)
      expect(rows[0]?.action).toBe("items.created")
      expect(rows[0]?.actorUserId).toBe(userId)
      expect(rows[0]?.ipAddress).toBe("127.0.0.1")
    })
  })
})
