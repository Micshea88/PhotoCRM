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

const filtersJsonSchema = z.array(filterSchema).max(64).optional().nullable()
const sortJsonSchema = z
  .union([sortSchema, z.array(sortSchema).max(8)])
  .optional()
  .nullable()
const visibleColumnsSchema = z.array(z.string().min(1).max(120)).max(64).optional().nullable()
const groupingSchema = z.string().max(120).optional().nullable()
const customFieldsSchema = z.record(z.string(), z.unknown()).optional().nullable()

export const createSavedViewInput = z.object({
  objectType: savedViewObjectTypeSchema,
  name: z.string().min(1).max(120),
  shared: z.boolean().default(false),
  filters: filtersJsonSchema,
  sort: sortJsonSchema,
  visibleColumns: visibleColumnsSchema,
  grouping: groupingSchema,
  customFields: customFieldsSchema,
})

export const updateSavedViewInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(120).optional(),
  shared: z.boolean().optional(),
  filters: filtersJsonSchema,
  sort: sortJsonSchema,
  visibleColumns: visibleColumnsSchema,
  grouping: groupingSchema,
  customFields: customFieldsSchema,
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
