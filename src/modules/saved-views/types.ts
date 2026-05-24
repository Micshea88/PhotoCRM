import { z } from "zod"

/**
 * Per Requirements §4.11. Every list view renders from this engine.
 * Vendor Matrix is `object_type='contact'` with a filter
 * `contactType eq 'Vendor'`; Team This Week is `object_type='task'`
 * with grouping by assignee × due_date.
 *
 * Adding a new object_type is a code-only change (Zod enum update +
 * the host list view implementing the columns/filters).
 */
export const SAVED_VIEW_OBJECT_TYPES = [
  "contact",
  "project",
  "opportunity",
  "task",
  "company",
] as const
export const savedViewObjectTypeSchema = z.enum(SAVED_VIEW_OBJECT_TYPES)
export type SavedViewObjectType = z.infer<typeof savedViewObjectTypeSchema>

/**
 * Three-tier visibility model.
 *
 *   private        — owner only
 *   shared_users   — owner + the users listed in shared_with_user_ids
 *   org            — every member of the org
 */
export const VISIBILITY_LEVELS = ["private", "shared_users", "org"] as const
export const visibilitySchema = z.enum(VISIBILITY_LEVELS)
export type Visibility = z.infer<typeof visibilitySchema>

/**
 * Canonical filter shape. The list-view renderer reads these and
 * applies them per object_type. `op` values are the set this engine
 * supports out of the box; modules can extend by handling new ops
 * at render time (the validator stores whatever shape arrives).
 *
 * For V1 we keep this loose — the renderer is the source of truth
 * for what ops are valid per field-type. The renderer will fail
 * gracefully on unknown ops (display "filter ignored").
 */
export const FILTER_OPS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "contains",
  "starts_with",
  "ends_with",
  "is_null",
  "is_not_null",
] as const

export const filterSchema = z
  .object({
    field: z.string().min(1).max(120),
    op: z.enum(FILTER_OPS),
    value: z.unknown().optional(),
  })
  .strict()

export const sortSchema = z
  .object({
    field: z.string().min(1).max(120),
    direction: z.enum(["asc", "desc"]).default("asc"),
  })
  .strict()

/**
 * Column-config item shape. One entry per column the host list view
 * knows about. `order` is the persisted display index (0-based);
 * `visible` toggles the column off; `width` is in pixels (NULL =
 * renderer default).
 */
export const columnConfigItemSchema = z
  .object({
    id: z.string().min(1).max(120),
    visible: z.boolean(),
    order: z.number().int().nonnegative(),
    width: z.number().int().positive().nullable(),
  })
  .strict()
export const columnConfigSchema = z.array(columnConfigItemSchema).max(64)
export type ColumnConfigItem = z.infer<typeof columnConfigItemSchema>

const filtersJsonSchema = z.array(filterSchema).max(64).optional().nullable()
const sortJsonSchema = z
  .union([sortSchema, z.array(sortSchema).max(8)])
  .optional()
  .nullable()
const columnConfigJsonSchema = columnConfigSchema.optional().nullable()
const groupingSchema = z.string().max(120).optional().nullable()
const customFieldsSchema = z.record(z.string(), z.unknown()).optional().nullable()
const sharedWithUserIdsSchema = z.array(z.string().min(1).max(64)).max(64).optional().nullable()

/**
 * Push 2c.6.1 → 2c.6.2 — separate-but-equivalent variants of the
 * optional+nullable schemas above, used by createSavedView only.
 *
 * 2c.6.1 attempted `.nullable().default(null)` here as a Zod-level
 * coercion. Production logs from deployment EBcSo7Aic showed the
 * fix did NOT land: the rendered Drizzle params for shared_with_
 * user_ids, sort, grouping, custom_fields were still empty (not
 * SQL NULL) and the INSERT continued to fail. Either Zod's default
 * isn't reaching the action body via next-safe-action's parsing
 * pipeline, or Drizzle's value serializer is dropping the
 * already-null value to an empty parameter slot.
 *
 * 2c.6.2 moves the defaulting back to the action body via explicit
 * object construction (see actions.ts:createSavedView). These
 * schemas remain separate from the update variants so future
 * divergence (e.g., adding a stricter create-only rule) is a
 * one-line edit, but they no longer carry `.default()` — the
 * action handler is the single source of truth for the absent
 * → null/[] mapping.
 *
 * updateSavedView still uses the bare optional+nullable variants
 * — its partial-update semantics depend on `parsedInput.field ===
 * undefined` meaning "don't touch this column".
 */
const filtersJsonSchemaForCreate = filtersJsonSchema
const sortJsonSchemaForCreate = sortJsonSchema
const columnConfigJsonSchemaForCreate = columnConfigJsonSchema
const groupingSchemaForCreate = groupingSchema
const customFieldsSchemaForCreate = customFieldsSchema
const sharedWithUserIdsSchemaForCreate = sharedWithUserIdsSchema

/**
 * Push 2c — pinned-tab soft cap. Total saved views per user is now
 * unlimited; only the count of views the user has PINNED to the tab
 * strip is bounded. Enforced at the action layer (see actions.ts:pinView)
 * so an over-limit pinnedViewIds upsert via updateUserViewPrefs is also
 * rejected.
 */
export const MAX_PINNED_VIEWS = 6

export const createSavedViewInput = z
  .object({
    objectType: savedViewObjectTypeSchema,
    name: z.string().min(1).max(120),
    visibility: visibilitySchema.default("private"),
    // Push 2c.6.1 — explicit nullable+default so parsedInput never
    // carries `undefined` into Drizzle. See the comment block on
    // *ForCreate schemas above for the production failure context.
    sharedWithUserIds: sharedWithUserIdsSchemaForCreate,
    filters: filtersJsonSchemaForCreate,
    sort: sortJsonSchemaForCreate,
    columnConfig: columnConfigJsonSchemaForCreate,
    grouping: groupingSchemaForCreate,
    customFields: customFieldsSchemaForCreate,
  })
  .superRefine((data, ctx) => {
    if (
      data.visibility === "shared_users" &&
      (!data.sharedWithUserIds || data.sharedWithUserIds.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sharedWithUserIds"],
        message: "sharedWithUserIds must be a non-empty list when visibility is 'shared_users'",
      })
    }
  })

export const updateSavedViewInput = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(120).optional(),
    visibility: visibilitySchema.optional(),
    sharedWithUserIds: sharedWithUserIdsSchema,
    filters: filtersJsonSchema,
    sort: sortJsonSchema,
    columnConfig: columnConfigJsonSchema,
    grouping: groupingSchema,
    customFields: customFieldsSchema,
  })
  .superRefine((data, ctx) => {
    if (
      data.visibility === "shared_users" &&
      (!data.sharedWithUserIds || data.sharedWithUserIds.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sharedWithUserIds"],
        message: "sharedWithUserIds must be a non-empty list when visibility is 'shared_users'",
      })
    }
  })

export const deleteSavedViewInput = z.object({ id: z.string() })
export const restoreSavedViewInput = z.object({ id: z.string() })

export const duplicateSavedViewInput = z.object({
  id: z.string(),
  newName: z.string().min(1).max(120),
})

export type CreateSavedViewInput = z.infer<typeof createSavedViewInput>
export type UpdateSavedViewInput = z.infer<typeof updateSavedViewInput>
export type FilterOp = (typeof FILTER_OPS)[number]
export type Filter = z.infer<typeof filterSchema>
export type Sort = z.infer<typeof sortSchema>
