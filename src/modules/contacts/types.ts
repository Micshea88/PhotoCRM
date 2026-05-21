import { z } from "zod"

/**
 * Contact category. Per Requirements §6.1. Stored as text; validated
 * app-side via this Zod enum so additions don't require a migration.
 */
export const CONTACT_TYPES = [
  "Lead",
  "Active Client",
  "Past Client",
  "Vendor",
  "Contractor",
  "Referral Partner",
] as const

export const contactTypeSchema = z.enum(CONTACT_TYPES)
export type ContactType = z.infer<typeof contactTypeSchema>

/**
 * Per Requirements §6.1. "Do Not Contact" is an explicit compliance state
 * — workflow actions that send to the contact must check this and skip.
 */
export const LIFECYCLE_STATUSES = ["Active", "Inactive", "VIP", "Do Not Contact"] as const

export const lifecycleStatusSchema = z.enum(LIFECYCLE_STATUSES)
export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>

/**
 * Shape stored in `contacts.mailing_address jsonb`. All fields optional —
 * U.S.-centric defaults (state, zip) but international-tolerant
 * (country fallback). The jsonb column accepts arbitrary keys; consumers
 * should parse through this schema.
 */
export const mailingAddressSchema = z
  .object({
    street: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    zip: z.string().max(40).optional(),
    country: z.string().max(80).optional(),
  })
  .strict()

export type MailingAddress = z.infer<typeof mailingAddressSchema>

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()

const optionalEmail = z
  .union([z.email(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()

const optionalUrl = z
  .union([z.url(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()

const isoDateNullable = z
  .union([z.iso.date(), z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()

/**
 * `custom_fields` is accepted as a loose jsonb shape for V1. Per-field-type
 * value validation (where each entry is checked against its corresponding
 * `custom_field_definitions` row's `field_type`) is the next foreseeable
 * follow-up — flagged in the module README and in custom-fields/README.
 */
const customFieldsSchema = z.record(z.string(), z.unknown()).optional().nullable()

export const createContactInput = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  companyId: z.string().nullable().optional(),
  primaryEmail: optionalEmail.optional(),
  secondaryEmail: optionalEmail.optional(),
  primaryPhone: optionalText(80).optional(),
  secondaryPhone: optionalText(80).optional(),
  mailingAddress: mailingAddressSchema.partial().optional().nullable(),
  dob: isoDateNullable.optional(),
  anniversaryDate: isoDateNullable.optional(),
  instagramHandle: optionalText(120).optional(),
  facebookUrl: optionalUrl.optional(),
  website: optionalUrl.optional(),
  leadSource: optionalText(120).optional(),
  sourceDetail: optionalText(500).optional(),
  referredByContactId: z.string().nullable().optional(),
  contactType: contactTypeSchema.optional(),
  lifecycleStatus: lifecycleStatusSchema.optional(),
  tags: z.array(z.string().max(80)).max(64).optional(),
  ownerUserId: z.string().nullable().optional(),
  notes: optionalText(10000).optional(),
  internalNotes: optionalText(10000).optional(),
  customFields: customFieldsSchema,
})

export const updateContactInput = createContactInput.partial().extend({ id: z.string() })

export const deleteContactInput = z.object({ id: z.string() })
export const restoreContactInput = z.object({ id: z.string() })

export const searchContactsInput = z.object({
  q: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(10),
})

// ─── Bulk restore (P4.2) ──────────────────────────────────────────────
export const bulkRestoreContactsInput = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
})

// ─── Contact notes (P4.2) ─────────────────────────────────────────────
export const createContactNoteInput = z.object({
  contactId: z.string().min(1),
  body: z.string().min(1).max(10000),
})
export const updateContactNoteInput = z.object({
  id: z.string().min(1),
  body: z.string().min(1).max(10000),
})
export const deleteContactNoteInput = z.object({ id: z.string().min(1) })

// ─── Contact↔company associations (P4.2) ──────────────────────────────
const optionalRole = z
  .string()
  .max(120)
  .transform((v) => (v.trim() === "" ? null : v.trim()))
  .nullable()
  .optional()

export const addContactCompanyAssociationInput = z.object({
  contactId: z.string().min(1),
  companyId: z.string().min(1),
  role: optionalRole,
})
export const updateContactCompanyAssociationInput = z.object({
  id: z.string().min(1),
  role: optionalRole,
})
export const removeContactCompanyAssociationInput = z.object({ id: z.string().min(1) })

export type CreateContactInput = z.infer<typeof createContactInput>
export type CreateContactFormValues = z.input<typeof createContactInput>
export type UpdateContactInput = z.infer<typeof updateContactInput>
export type SearchContactsInput = z.infer<typeof searchContactsInput>
export type BulkRestoreContactsInput = z.infer<typeof bulkRestoreContactsInput>
export type CreateContactNoteInput = z.infer<typeof createContactNoteInput>
export type UpdateContactNoteInput = z.infer<typeof updateContactNoteInput>
export type AddContactCompanyAssociationInput = z.infer<typeof addContactCompanyAssociationInput>
export type UpdateContactCompanyAssociationInput = z.infer<
  typeof updateContactCompanyAssociationInput
>
