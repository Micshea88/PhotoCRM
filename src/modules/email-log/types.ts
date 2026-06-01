import { z } from "zod"

/**
 * Direction of a logged email. "outbound" = sent by us; "inbound" =
 * received from the contact. Matches the call_log convention so the
 * activity feed can render both with the same direction-aware
 * primitives.
 */
export const EMAIL_DIRECTIONS = ["outbound", "inbound"] as const
export const emailDirectionSchema = z.enum(EMAIL_DIRECTIONS)
export type EmailDirection = z.infer<typeof emailDirectionSchema>

/**
 * Source of the email_log row. "manual" today; "gmail" / "outlook" /
 * "resend" reserved for the future provider integrations.
 */
export const EMAIL_SOURCES = ["manual", "gmail", "outlook", "resend"] as const
export const emailSourceSchema = z.enum(EMAIL_SOURCES)
export type EmailSource = z.infer<typeof emailSourceSchema>

const attachmentSchema = z.object({
  fileId: z.string().min(1),
  name: z.string().max(512),
  size: z.number().int().min(0),
})

/**
 * Input for the manual Log Email composer. `source` is "manual" at
 * the action layer; the form doesn't expose it. `external_id` /
 * `external_metadata` stay null for manual entries.
 */
export const logEmailInput = z.object({
  contactId: z.string().min(1),
  sentAt: z.iso.datetime(),
  direction: emailDirectionSchema,
  subject: z.string().max(998).nullable().optional(),
  body: z.string().max(50_000).nullable().optional(),
  attachments: z.array(attachmentSchema).max(20).nullable().optional(),
})

export const updateEmailInput = z.object({
  id: z.string().min(1),
  sentAt: z.iso.datetime().optional(),
  direction: emailDirectionSchema.optional(),
  subject: z.string().max(998).nullable().optional(),
  body: z.string().max(50_000).nullable().optional(),
  attachments: z.array(attachmentSchema).max(20).nullable().optional(),
})

export const deleteEmailInput = z.object({ id: z.string().min(1) })

export type LogEmailInput = z.infer<typeof logEmailInput>
export type UpdateEmailInput = z.infer<typeof updateEmailInput>
export type DeleteEmailInput = z.infer<typeof deleteEmailInput>
