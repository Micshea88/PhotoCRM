/**
 * Push 2c.5 — regression coverage for the "Save view → Something
 * went wrong" production report.
 *
 * Likely root cause (no Vercel trace surfaced for the relevant
 * window): drag-resize on Retina screens produces float widths
 * (e.g. 247.5 from subpixel mouse events). The savedViews
 * columnConfigItemSchema declares `width: z.number().int()` which
 * rejects floats. The wizard's previous error-handling only
 * checked result.serverError, so a Zod validation rejection
 * looked like silent failure to the user.
 *
 * Fixes shipped in 2c.5:
 *   - contacts-table.tsx: Math.round(startWidth + delta) so
 *     drag-resize ALWAYS produces an integer width.
 *   - saved-views-tab-strip.tsx: describeActionError() helper
 *     surfaces both serverError AND validationErrors via the
 *     alert path, so future Zod additions don't go silent.
 *
 * This test pins the columnConfig-with-integer-width happy path
 * and asserts the row materialises with the same shape.
 */

import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { savedViews } from "@/modules/saved-views/schema"
import { columnConfigItemSchema } from "@/modules/saved-views/types"

describe("saved_views — createSavedView regression (Push 2c.5)", () => {
  it("columnConfigItemSchema rejects float width (the production trap)", () => {
    const r = columnConfigItemSchema.safeParse({
      id: "primaryEmail",
      visible: true,
      order: 1,
      width: 247.5,
    })
    expect(r.success).toBe(false)
  })

  it("columnConfigItemSchema accepts integer width (the post-fix shape)", () => {
    const r = columnConfigItemSchema.safeParse({
      id: "primaryEmail",
      visible: true,
      order: 1,
      width: 248,
    })
    expect(r.success).toBe(true)
  })

  it("columnConfigItemSchema accepts null width (system default columns)", () => {
    const r = columnConfigItemSchema.safeParse({
      id: "displayLabel",
      visible: true,
      order: 0,
      width: null,
    })
    expect(r.success).toBe(true)
  })

  it("savedViews insert with the wizard's exact post-fix shape persists cleanly", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const id = createId()
      // Mimic the wizard's createSavedView payload shape with a mix
      // of null + integer widths (the post-fix world).
      await db.insert(savedViews).values({
        id,
        organizationId: orgId,
        objectType: "contact",
        name: "Test view from wizard",
        ownerUserId: userId,
        visibility: "private",
        sharedWithUserIds: null,
        filters: [{ field: "primaryPhone", op: "is_not_null", value: null }],
        sort: { field: "lastName", direction: "asc" },
        columnConfig: [
          { id: "displayLabel", visible: true, order: 0, width: null },
          { id: "primaryEmail", visible: true, order: 1, width: 248 },
          { id: "primaryPhone", visible: true, order: 2, width: 160 },
        ],
        createdBy: userId,
        updatedBy: userId,
      })

      const [row] = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.id, id),
            eq(savedViews.organizationId, orgId),
            isNull(savedViews.deletedAt),
          ),
        )
        .limit(1)
      expect(row?.name).toBe("Test view from wizard")
      expect(row?.columnConfig).toHaveLength(3)
    })
  })
})
