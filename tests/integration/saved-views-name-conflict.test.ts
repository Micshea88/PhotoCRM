/**
 * Push 2c.6.3 — regression coverage for the actual save-view bug
 * surfaced (finally) by the 2c.6.2 e.cause logging.
 *
 * Production error from deployment FHWJqRmMonNeVNh (the 2c.6.2
 * build):
 *
 *   cause: duplicate key value violates unique constraint
 *          "saved_views_org_owner_object_name_uidx"
 *
 * The partial unique index on (organization_id, owner_user_id,
 * object_type, name) WHERE deleted_at IS NULL was rejecting Mike's
 * second attempt to save a view named "vendors" — he already had
 * one. Push 2c.6.1 and 2c.6.2 were chasing a phantom (the empty
 * params in Drizzle's error log were NULLs rendered as nothing
 * between commas, not undefined-shaped wire artifacts).
 *
 * Fix: createSavedView / updateSavedView / duplicateSavedView wrap
 * their INSERT/UPDATE in a try/catch that translates the constraint
 * violation into a friendly CONFLICT error. The wizard's
 * describeActionError helper surfaces the result.serverError string
 * to the user via alert(), so "You already have a view named 'X'"
 * is what they see instead of a raw Drizzle dump.
 */

import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { savedViews } from "@/modules/saved-views/schema"

describe("saved_views — unique-name conflict path (Push 2c.6.3)", () => {
  it("the partial unique index rejects a duplicate active view name", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // First insert — succeeds.
      await db.insert(savedViews).values({
        id: createId(),
        organizationId: orgId,
        objectType: "contact",
        name: "vendors",
        ownerUserId: userId,
        visibility: "private",
        sharedWithUserIds: null,
        filters: null,
        sort: null,
        columnConfig: [],
        grouping: null,
        customFields: null,
        createdBy: userId,
        updatedBy: userId,
      })

      // Second insert with the same (org, owner, object_type, name)
      // tuple → rejected by the partial unique index. The pg error
      // surfaces with code "23505" + constraint name, which the
      // 2c.6.3 catch translates into ActionError("CONFLICT", …).
      let caught: unknown = null
      try {
        await db.insert(savedViews).values({
          id: createId(),
          organizationId: orgId,
          objectType: "contact",
          name: "vendors",
          ownerUserId: userId,
          visibility: "private",
          sharedWithUserIds: null,
          filters: null,
          sort: null,
          columnConfig: [],
          grouping: null,
          customFields: null,
          createdBy: userId,
          updatedBy: userId,
        })
      } catch (err) {
        caught = err
      }
      expect(caught).toBeTruthy()
      const cause = (caught as { cause?: { code?: string; constraint?: string } }).cause
      expect(cause?.code).toBe("23505")
      expect(cause?.constraint).toBe("saved_views_org_owner_object_name_uidx")
    })
  })

  it("recycles the name after the prior view is soft-deleted", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const firstId = createId()
      await db.insert(savedViews).values({
        id: firstId,
        organizationId: orgId,
        objectType: "contact",
        name: "vendors",
        ownerUserId: userId,
        visibility: "private",
        sharedWithUserIds: null,
        filters: null,
        sort: null,
        columnConfig: [],
        grouping: null,
        customFields: null,
        createdBy: userId,
        updatedBy: userId,
      })

      // Soft-delete the first view → the partial index (WHERE
      // deleted_at IS NULL) no longer covers this row.
      await db
        .update(savedViews)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(eq(savedViews.id, firstId))

      // Now the same name should insert cleanly.
      const secondId = createId()
      await db.insert(savedViews).values({
        id: secondId,
        organizationId: orgId,
        objectType: "contact",
        name: "vendors",
        ownerUserId: userId,
        visibility: "private",
        sharedWithUserIds: null,
        filters: null,
        sort: null,
        columnConfig: [],
        grouping: null,
        customFields: null,
        createdBy: userId,
        updatedBy: userId,
      })

      const [row] = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.id, secondId),
            eq(savedViews.organizationId, orgId),
            isNull(savedViews.deletedAt),
          ),
        )
        .limit(1)
      expect(row?.name).toBe("vendors")
    })
  })
})
