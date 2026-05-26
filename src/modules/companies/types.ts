import { z } from "zod"

/**
 * Validated input shapes for the companies module's server actions. The
 * `check-actions` static check (run by `pnpm verify --tier=1`) enforces
 * that every action chain has `.inputSchema(...)` — these are the values.
 *
 * Category is plain text in V1; the Vendor Matrix module (Phase 4) will
 * curate an enum and migrate values then.
 */

const websiteSchema = z
  .union([z.url(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()

const optionalText = z
  .string()
  .max(200)
  .transform((v) => (v.trim() === "" ? null : v.trim()))
  .nullable()

// Push 4 (A3) — custom_fields jsonb payload. Validation happens at the
// action layer against the org's custom_field_definitions for
// record_type='company'. Shape is unknown at the input-schema level
// because the actual schema is per-org.
const customFieldsSchema = z.record(z.string(), z.unknown()).nullable().optional()

export const createCompanyInput = z.object({
  name: z.string().min(1).max(200),
  website: websiteSchema.optional(),
  mainPhone: optionalText.optional(),
  instagramHandle: optionalText.optional(),
  category: optionalText.optional(),
  customFields: customFieldsSchema,
})

export const updateCompanyInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  website: websiteSchema.optional(),
  mainPhone: optionalText.optional(),
  instagramHandle: optionalText.optional(),
  category: optionalText.optional(),
  customFields: customFieldsSchema,
})

export const deleteCompanyInput = z.object({ id: z.string() })
export const restoreCompanyInput = z.object({ id: z.string() })

export const searchCompaniesInput = z.object({
  q: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(10),
})

export type CreateCompanyInput = z.infer<typeof createCompanyInput>
export type CreateCompanyFormValues = z.input<typeof createCompanyInput>
export type UpdateCompanyInput = z.infer<typeof updateCompanyInput>
export type SearchCompaniesInput = z.infer<typeof searchCompaniesInput>
