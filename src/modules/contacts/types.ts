import { z } from "zod"
import { US_STATE_CODES } from "@/lib/format/us-states"

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
 * Shape stored in `contacts.mailing_address jsonb`. US-only per LOC1
 * (no country field, no international tolerance). State is the 2-letter
 * postal code, validated against the canonical set in
 * `@/lib/format/us-states`. ZIP is 5-digit or ZIP+4 (`12345` or
 * `12345-6789`). All fields optional — a partial address (e.g., city
 * only) is allowed because Phase 4 importers sometimes have just the
 * city. The jsonb column accepts arbitrary keys; consumers should
 * parse through this schema.
 */
const stateCodeSchema = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .refine(
    (v): v is (typeof US_STATE_CODES)[number] => (US_STATE_CODES as readonly string[]).includes(v),
    {
      message: "State must be a 2-letter US state or territory code",
    },
  )

const zipSchema = z
  .string()
  .trim()
  .regex(/^\d{5}(-\d{4})?$/, "ZIP must be 5 digits or ZIP+4 (12345 or 12345-6789)")

export const mailingAddressSchema = z
  .object({
    street1: z.string().max(200).optional(),
    street2: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: stateCodeSchema.optional(),
    zip: zipSchema.optional(),
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
export const archiveContactInput = z.object({ id: z.string().min(1) })
export const unarchiveContactInput = z.object({ id: z.string().min(1) })

export const searchContactsInput = z.object({
  q: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(10),
})

// ─── Bulk restore (P4.2) ──────────────────────────────────────────────
export const bulkRestoreContactsInput = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
})

// ─── Bulk actions (P4.2 push 2c) ──────────────────────────────────────
/**
 * Hard cap on bulk-action payload size. 200 is plenty for "select the
 * current page and apply an action" — page size cap is 100 — and bounds
 * the per-row audit-write loop. Above that, force users to refine the
 * filter or work in batches.
 */
export const BULK_ACTION_MAX_IDS = 200

const bulkIdsSchema = z.array(z.string().min(1)).min(1).max(BULK_ACTION_MAX_IDS)

export const bulkDeleteContactsInput = z.object({ ids: bulkIdsSchema })

export const bulkChangeOwnerInput = z.object({
  ids: bulkIdsSchema,
  ownerUserId: z.string().min(1).nullable(),
})

export const bulkChangeStatusInput = z.object({
  ids: bulkIdsSchema,
  lifecycleStatus: lifecycleStatusSchema,
})

export const bulkChangeContactTypeInput = z.object({
  ids: bulkIdsSchema,
  contactType: contactTypeSchema,
})

// Push 2c.4 part 2 — Bulk edit drawer's single-dispatch input. The
// drawer collects ONE field + value at a time (Apply commits, drawer
// clears). The server switches on update.kind to apply the right
// column / mutation. Multi-field edits are intentionally NOT supported
// in V1 — keep the contract simple, easy to audit, easy to test.
const bulkFieldUpdateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("firstName"), value: z.string().min(1).max(120) }),
  z.object({ kind: z.literal("lastName"), value: z.string().min(1).max(120) }),
  z.object({
    kind: z.literal("primaryEmail"),
    value: z.union([z.email(), z.literal("")]),
  }),
  z.object({
    kind: z.literal("secondaryEmail"),
    value: z.union([z.email(), z.literal("")]),
  }),
  z.object({ kind: z.literal("primaryPhone"), value: z.string().max(80) }),
  z.object({ kind: z.literal("secondaryPhone"), value: z.string().max(80) }),
  z.object({ kind: z.literal("companyId"), value: z.string().nullable() }),
  z.object({ kind: z.literal("contactType"), value: contactTypeSchema }),
  z.object({ kind: z.literal("lifecycleStatus"), value: lifecycleStatusSchema }),
  z.object({ kind: z.literal("leadSource"), value: z.string().max(120).nullable() }),
  z.object({ kind: z.literal("ownerUserId"), value: z.string().min(1).nullable() }),
  z.object({
    kind: z.literal("tagsAdd"),
    value: z.array(z.string().min(1).max(80)).min(1).max(32),
  }),
  z.object({
    kind: z.literal("tagsRemove"),
    value: z.array(z.string().min(1).max(80)).min(1).max(32),
  }),
  z.object({
    kind: z.literal("tagsReplace"),
    value: z.array(z.string().min(1).max(80)).max(64),
  }),
  z.object({ kind: z.literal("mailingStreet"), value: z.string().max(200) }),
  z.object({ kind: z.literal("mailingCity"), value: z.string().max(120) }),
  z.object({ kind: z.literal("mailingState"), value: z.string().length(2) }),
  z.object({
    kind: z.literal("mailingPostalCode"),
    value: z.string().regex(/^\d{5}(-\d{4})?$/),
  }),
])
export type BulkFieldUpdate = z.infer<typeof bulkFieldUpdateSchema>

export const bulkUpdateContactFieldsInput = z.object({
  ids: bulkIdsSchema,
  update: bulkFieldUpdateSchema,
})

export const bulkAddTagInput = z.object({
  ids: bulkIdsSchema,
  tag: z.string().min(1).max(80),
})

export const bulkRemoveTagInput = z.object({
  ids: bulkIdsSchema,
  tag: z.string().min(1).max(80),
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
export type ArchiveContactInput = z.infer<typeof archiveContactInput>
export type UnarchiveContactInput = z.infer<typeof unarchiveContactInput>
export type SearchContactsInput = z.infer<typeof searchContactsInput>
export type BulkRestoreContactsInput = z.infer<typeof bulkRestoreContactsInput>
export type CreateContactNoteInput = z.infer<typeof createContactNoteInput>
export type UpdateContactNoteInput = z.infer<typeof updateContactNoteInput>
export type AddContactCompanyAssociationInput = z.infer<typeof addContactCompanyAssociationInput>
export type UpdateContactCompanyAssociationInput = z.infer<
  typeof updateContactCompanyAssociationInput
>
export type BulkDeleteContactsInput = z.infer<typeof bulkDeleteContactsInput>
export type BulkChangeOwnerInput = z.infer<typeof bulkChangeOwnerInput>
export type BulkChangeStatusInput = z.infer<typeof bulkChangeStatusInput>
export type BulkChangeContactTypeInput = z.infer<typeof bulkChangeContactTypeInput>
export type BulkUpdateContactFieldsInput = z.infer<typeof bulkUpdateContactFieldsInput>
export type BulkAddTagInput = z.infer<typeof bulkAddTagInput>
export type BulkRemoveTagInput = z.infer<typeof bulkRemoveTagInput>
