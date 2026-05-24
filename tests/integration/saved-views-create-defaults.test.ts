/**
 * Push 2c.6.1 — regression coverage for the createSavedView NULL-
 * default propagation bug surfaced by Push 2c.6 Part 1's
 * instrumentation.
 *
 * Failure mode in production: the wizard's doSaveAs handler calls
 * createSavedView with only the required fields plus filters/sort/
 * columnConfig — it omits `grouping`, `customFields`, and (for
 * private/org views) `sharedWithUserIds`. Those fields landed at the
 * action handler as `parsedInput.field === undefined`, propagated
 * into Drizzle's `.insert(savedViews).values({...})` call, and pg
 * rejected the INSERT (param values arrived as empty in the wire
 * format).
 *
 * Fix: each optional field's Zod schema in createSavedViewInput now
 * uses `.nullable().default(null)` (or `.default([])` for
 * sharedWithUserIds) so parsedInput carries an explicit null/[]
 * rather than undefined. The action body's `?? null` / `?? []`
 * ternaries remain as belt-and-suspenders.
 */

import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { savedViews } from "@/modules/saved-views/schema"
import { createSavedViewInput, updateSavedViewInput } from "@/modules/saved-views/types"

describe("createSavedViewInput — Push 2c.6.1 null-default coercion", () => {
  it("coerces omitted optional fields to null / [] (not undefined)", () => {
    const parsed = createSavedViewInput.parse({
      objectType: "contact",
      name: "Minimal view",
      // every other field omitted → mirrors the wizard's doSaveAs
      // payload for a private view with no grouping/customFields.
    })
    expect(parsed.visibility).toBe("private")
    expect(parsed.sharedWithUserIds).toBeNull()
    expect(parsed.filters).toBeNull()
    expect(parsed.sort).toBeNull()
    expect(parsed.columnConfig).toBeNull()
    expect(parsed.grouping).toBeNull()
    expect(parsed.customFields).toBeNull()
  })

  it("preserves explicit values; does not clobber them with the default", () => {
    const parsed = createSavedViewInput.parse({
      objectType: "contact",
      name: "Explicit view",
      visibility: "private",
      filters: [{ field: "primaryPhone", op: "is_not_null", value: null }],
      sort: { field: "lastName", direction: "asc" },
      columnConfig: [{ id: "displayLabel", visible: true, order: 0, width: 280 }],
      grouping: "lifecycleStatus",
      customFields: { ownerOverride: "abc123" },
    })
    expect(parsed.filters).toEqual([{ field: "primaryPhone", op: "is_not_null", value: null }])
    expect(parsed.sort).toEqual({ field: "lastName", direction: "asc" })
    expect(parsed.columnConfig).toHaveLength(1)
    expect(parsed.grouping).toBe("lifecycleStatus")
    expect(parsed.customFields).toEqual({ ownerOverride: "abc123" })
  })

  it("preserves explicit null; null and undefined collapse to the same output", () => {
    const parsed = createSavedViewInput.parse({
      objectType: "contact",
      name: "Explicit-null view",
      sharedWithUserIds: null,
      filters: null,
      sort: null,
      columnConfig: null,
      grouping: null,
      customFields: null,
    })
    expect(parsed.sharedWithUserIds).toBeNull()
    expect(parsed.filters).toBeNull()
    expect(parsed.sort).toBeNull()
    expect(parsed.columnConfig).toBeNull()
    expect(parsed.grouping).toBeNull()
    expect(parsed.customFields).toBeNull()
  })

  it("still rejects visibility=shared_users without sharedWithUserIds", () => {
    const r = createSavedViewInput.safeParse({
      objectType: "contact",
      name: "Bad shared view",
      visibility: "shared_users",
    })
    expect(r.success).toBe(false)
  })
})

describe("updateSavedViewInput — partial-update semantics preserved", () => {
  it("leaves omitted fields as undefined (does NOT coerce to null)", () => {
    const parsed = updateSavedViewInput.parse({
      id: "v_abc",
      name: "Renamed only",
    })
    expect(parsed.name).toBe("Renamed only")
    // The action body reads `rest.field !== undefined` to decide
    // whether to patch a column. Coercing absent → null here would
    // clobber existing data on every "rename only" call.
    expect(parsed.filters).toBeUndefined()
    expect(parsed.sort).toBeUndefined()
    expect(parsed.grouping).toBeUndefined()
    expect(parsed.customFields).toBeUndefined()
    expect(parsed.sharedWithUserIds).toBeUndefined()
    expect(parsed.columnConfig).toBeUndefined()
  })
})

describe("savedViews INSERT — production-shape minimal payload", () => {
  it("inserts cleanly with all jsonb/array nullables = null", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Build the exact payload the action would construct AFTER
      // Zod parsing of a minimal wizard call (post-2c.6.1 defaults
      // applied):
      const parsed = createSavedViewInput.parse({
        objectType: "contact",
        name: "Production minimal payload",
      })

      const id = createId()
      await db.insert(savedViews).values({
        id,
        organizationId: orgId,
        objectType: parsed.objectType,
        name: parsed.name,
        ownerUserId: userId,
        visibility: parsed.visibility,
        // Mirror the action body — kept as belt+suspenders even
        // though the parsed values are already null/[].
        sharedWithUserIds:
          parsed.visibility === "shared_users" ? (parsed.sharedWithUserIds ?? []) : null,
        filters: parsed.filters ?? null,
        sort: parsed.sort ?? null,
        columnConfig: parsed.columnConfig ?? [],
        grouping: parsed.grouping ?? null,
        customFields: parsed.customFields ?? null,
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
      expect(row?.name).toBe("Production minimal payload")
      expect(row?.visibility).toBe("private")
      expect(row?.sharedWithUserIds).toBeNull()
      expect(row?.filters).toBeNull()
      expect(row?.sort).toBeNull()
      expect(row?.grouping).toBeNull()
      expect(row?.customFields).toBeNull()
      // columnConfig has a NOT NULL + default '[]' at the schema
      // level — we coerce null → [] in the action body, so we
      // expect an empty array, not null.
      expect(row?.columnConfig).toEqual([])
    })
  })

  it("inserts cleanly with explicit nulls passed end-to-end", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Simulate the wizard sending explicit null for every optional
      // field — the alternate path that was already known to work
      // pre-2c.6.1 but should still work post-fix.
      const id = createId()
      await db.insert(savedViews).values({
        id,
        organizationId: orgId,
        objectType: "contact",
        name: "Explicit-null payload",
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

      const [row] = await db.select().from(savedViews).where(eq(savedViews.id, id)).limit(1)
      expect(row).toBeTruthy()
      expect(row?.sharedWithUserIds).toBeNull()
      expect(row?.filters).toBeNull()
    })
  })
})
