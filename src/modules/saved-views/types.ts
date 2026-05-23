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
