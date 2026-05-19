import { z } from "zod"

/**
 * V1 project types per Requirements §6.2. Stored as text; validated by
 * this Zod enum. Adding a new type (e.g., "Boudoir") is a code-only
 * change. The leading "Wedding" type triggers anniversary-date
 * auto-derivation in createProject; other types pass `anniversary_date`
 * through verbatim or null.
 */
export const PROJECT_TYPES = [
  "Wedding",
  "Engagement Shoot",
  "Proposal",
  "Social Event",
  "Family",
  "Portrait",
  "Corporate",
  "Custom",
] as const

export const projectTypeSchema = z.enum(PROJECT_TYPES)
export type ProjectType = z.infer<typeof projectTypeSchema>

/**
 * High-level lifecycle status per the spec. Pipeline-stage progress is
 * tracked separately on the opportunities table when that ships — this
 * is just the overall project state.
 */
export const PROJECT_LIFECYCLE_STATUSES = [
  "Inquiry",
  "Booked",
  "Active",
  "Complete",
  "Cancelled",
  "Lost",
] as const

export const projectLifecycleStatusSchema = z.enum(PROJECT_LIFECYCLE_STATUSES)
export type ProjectLifecycleStatus = z.infer<typeof projectLifecycleStatusSchema>

export const DISCOUNT_TYPES = ["none", "percent", "flat"] as const
export const discountTypeSchema = z.enum(DISCOUNT_TYPES)

export const TAX_SIGNS = ["add", "subtract"] as const
export const taxSignSchema = z.enum(TAX_SIGNS)

export const PROJECT_CONTACT_ROLES = ["primary", "partner", "billing", "vendor"] as const
export const projectContactRoleSchema = z.enum(PROJECT_CONTACT_ROLES)
export type ProjectContactRole = z.infer<typeof projectContactRoleSchema>

export const PHOTOGRAPHER_ROLES = ["lead", "second", "backup"] as const
export const photographerRoleSchema = z.enum(PHOTOGRAPHER_ROLES)

export const CONFIRMATION_STATUSES = ["pending", "confirmed", "declined"] as const
export const confirmationStatusSchema = z.enum(CONFIRMATION_STATUSES)

export const SUB_EVENT_TYPES = [
  "engagement",
  "rehearsal_dinner",
  "wedding_day",
  "post_wedding_brunch",
  "bridal_portraits",
  "custom",
] as const
export const subEventTypeSchema = z.enum(SUB_EVENT_TYPES)

// Common reusable schemas
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()

const isoDateNullable = z
  .union([z.iso.date(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()

const venueJsonSchema = z
  .object({
    street: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    zip: z.string().max(40).optional(),
    country: z.string().max(80).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict()
  .optional()
  .nullable()

const coordsSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict()
  .optional()
  .nullable()

const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  amountCents: z.number().int(),
  quantity: z.number().int().min(1).default(1),
  taxable: z.boolean().default(false),
})

const customFieldsSchema = z.record(z.string(), z.unknown()).optional().nullable()

// ─── ACTION INPUT SCHEMAS ─────────────────────────────────────────────

export const createProjectInput = z.object({
  name: z.string().min(1).max(300),
  projectType: projectTypeSchema.optional(),
  lifecycleStatus: projectLifecycleStatusSchema.optional(),
  primaryDate: isoDateNullable.optional(),
  startDatetime: z.iso.datetime().optional().nullable(),
  endDatetime: z.iso.datetime().optional().nullable(),
  hoursOfCoverage: z
    .number()
    .int()
    .min(0)
    .max(24 * 30)
    .optional()
    .nullable(),
  photographerCount: z.number().int().min(0).max(50).optional().nullable(),
  primaryVenueName: optionalText(200).optional(),
  primaryVenueAddress: venueJsonSchema,
  primaryVenueCoordinates: coordsSchema,
  ceremonyVenue: venueJsonSchema,
  receptionVenue: venueJsonSchema,
  venueNotes: optionalText(2000).optional(),
  packageName: optionalText(200).optional(),
  packageBasePriceCents: z.number().int().min(0).optional().nullable(),
  lineItems: z.array(lineItemSchema).optional().nullable(),
  discountType: discountTypeSchema.optional(),
  discountValue: z.number().int().min(0).optional().nullable(),
  taxRateBps: z.number().int().min(0).max(100_000).optional().nullable(),
  taxSign: taxSignSchema.optional(),
  anniversaryDate: isoDateNullable.optional(),
  leadSource: optionalText(120).optional(),
  referredByContactId: z.string().nullable().optional(),
  projectNotes: optionalText(10000).optional(),
  internalNotes: optionalText(10000).optional(),
  customFields: customFieldsSchema,
  templateId: z.string().nullable().optional(),
})

export const updateProjectInput = createProjectInput.partial().extend({ id: z.string() })

export const deleteProjectInput = z.object({ id: z.string() })
export const restoreProjectInput = z.object({ id: z.string() })

// Association actions
export const addProjectContactInput = z.object({
  projectId: z.string(),
  contactId: z.string(),
  role: projectContactRoleSchema,
})
export const removeProjectContactInput = z.object({ id: z.string() })

export const addProjectPhotographerInput = z.object({
  projectId: z.string(),
  userId: z.string(),
  role: photographerRoleSchema,
})
export const removeProjectPhotographerInput = z.object({ id: z.string() })
export const updatePhotographerConfirmationInput = z.object({
  id: z.string(),
  confirmationStatus: confirmationStatusSchema,
})

// Sub-event actions
export const addProjectSubEventInput = z.object({
  projectId: z.string(),
  eventType: subEventTypeSchema,
  included: z.boolean().default(true),
  eventDate: isoDateNullable.optional(),
  venue: optionalText(500).optional(),
  photographerUserId: z.string().nullable().optional(),
})
export const updateProjectSubEventInput = z.object({
  id: z.string(),
  included: z.boolean().optional(),
  eventDate: isoDateNullable.optional(),
  venue: optionalText(500).optional(),
  photographerUserId: z.string().nullable().optional(),
  galleryDeliveredAt: z.iso.datetime().optional().nullable(),
})
export const removeProjectSubEventInput = z.object({ id: z.string() })

export type CreateProjectInput = z.infer<typeof createProjectInput>
export type UpdateProjectInput = z.infer<typeof updateProjectInput>
export type AddProjectContactInput = z.infer<typeof addProjectContactInput>
export type AddProjectPhotographerInput = z.infer<typeof addProjectPhotographerInput>
export type AddProjectSubEventInput = z.infer<typeof addProjectSubEventInput>
