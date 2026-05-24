/**
 * Push 2c.6.1 → 2c.6.2 — regression coverage for the createSavedView
 * NULL-default propagation bug.
 *
 * Failure mode in production (deployment EBcSo7Aic): the wizard's
 * doSaveAs handler calls createSavedView with only the required
 * fields plus filters/sort/columnConfig — it omits `grouping`,
 * `customFields`, and (for private/org views) `sharedWithUserIds`.
 * Those fields landed at the action handler as `parsedInput.field
 * === undefined`, propagated into Drizzle's `.insert(savedViews)
 * .values({...})` call, and pg rejected the INSERT (param values
 * arrived as empty in the wire format).
 *
 * 2c.6.1 attempted `.nullable().default(null)` at the Zod schema
 * layer. The production logs after that deploy showed it did NOT
 * work — params at positions 7, 9, 11, 12 were still empty. The
 * Zod default wasn't propagating through next-safe-action's parsing
 * pipeline as expected.
 *
 * 2c.6.2 moves the defaulting to the action handler body via
 * explicit object construction (a typed `values` variable with
 * `?? null` / `?? []` on every nullable column) so there's a
 * single, unambiguous code path between parsedInput and Drizzle's
 * value serializer. The *ForCreate schemas in types.ts remain
 * separate from the update schemas (for future divergence) but
 * are now identical aliases to the optional+nullable forms.
 */

import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { savedViews } from "@/modules/saved-views/schema"
import { createSavedViewInput, updateSavedViewInput } from "@/modules/saved-views/types"

describe("createSavedViewInput — Push 2c.6.2 schema contract", () => {
  it("accepts minimal input; optional fields parse as undefined post-2c.6.2", () => {
    // The handler body — not the Zod schema — is responsible for
    // coercing absent → null/[]. This test pins the Zod contract:
    // omitted optional fields produce undefined-keyed parsed output
    // (the default Zod behavior for .optional().nullable()).
    const parsed = createSavedViewInput.parse({
      objectType: "contact",
      name: "Minimal view",
    })
    expect(parsed.visibility).toBe("private")
    expect(parsed.sharedWithUserIds).toBeUndefined()
    expect(parsed.filters).toBeUndefined()
    expect(parsed.sort).toBeUndefined()
    expect(parsed.columnConfig).toBeUndefined()
    expect(parsed.grouping).toBeUndefined()
    expect(parsed.customFields).toBeUndefined()
  })

  it("preserves explicit values; passes them straight through", () => {
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

  it("accepts explicit null for each optional field", () => {
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
  it("inserts cleanly when handler defaults absent → null/[]", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Mirror the production failure path: parse a minimal wizard
      // payload (no grouping/customFields/sharedWithUserIds) through
      // Zod, then construct the INSERT values exactly as the action
      // handler does — with explicit `?? null` / `?? []` on every
      // nullable column. The 2c.6.2 fix lives in this construction
      // step, not in Zod.
      const parsed = createSavedViewInput.parse({
        objectType: "contact",
        name: "Production minimal payload",
      })

      // Sanity check the regression — parsedInput.field must be
      // undefined post-2c.6.2 for the handler-body defaults to be
      // load-bearing.
      expect(parsed.sharedWithUserIds).toBeUndefined()
      expect(parsed.sort).toBeUndefined()
      expect(parsed.grouping).toBeUndefined()
      expect(parsed.customFields).toBeUndefined()

      const id = createId()
      await db.insert(savedViews).values({
        id,
        organizationId: orgId,
        objectType: parsed.objectType,
        name: parsed.name,
        ownerUserId: userId,
        visibility: parsed.visibility,
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
