import { z } from "zod"

/**
 * Direction of a phone call. Matches what the activity feed renders
 * and what RingCentral webhooks will translate into.
 */
export const CALL_DIRECTIONS = ["incoming", "outgoing", "missed"] as const
export const callDirectionSchema = z.enum(CALL_DIRECTIONS)
export type CallDirection = z.infer<typeof callDirectionSchema>

/**
 * Source of the call record. `"manual"` for user-entered, `"ringcentral"`
 * for auto-synced via the future webhook integration. Schema kept open-
 * ended (Zod enum) so additional providers can be added without
 * migration.
 */
export const CALL_SOURCES = ["manual", "ringcentral"] as const
export const callSourceSchema = z.enum(CALL_SOURCES)
export type CallSource = z.infer<typeof callSourceSchema>

/**
 * Input for the manual "Log Call" form. `source` is always "manual" at
 * the action layer; we don't expose it as a form field. `external_id`
 * and `external_metadata` are left null for manual entries — they're
 * reserved for the RingCentral integration that lands in a later
 * commit (P4-calls-ringcentral or similar).
 */
export const logCallInput = z.object({
  contactId: z.string().min(1),
  // ISO 8601 datetime when the call started (e.g., "2026-05-21T14:30:00Z").
  startedAt: z.iso.datetime(),
  direction: callDirectionSchema,
  // Optional, in seconds. 0 or null means duration unknown / didn't connect.
  durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  // Optional file_id from a prior /api/blob/upload — links the call to
  // an audio recording.
  recordingFileId: z.string().nullable().optional(),
})

export const updateCallInput = z.object({
  id: z.string().min(1),
  startedAt: z.iso.datetime().optional(),
  direction: callDirectionSchema.optional(),
  durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  recordingFileId: z.string().nullable().optional(),
})

export const deleteCallInput = z.object({ id: z.string().min(1) })

/**
 * Disposition of an outbound call placed via the inline dialer.
 * Maps to the synthesized notes copy that lands on the row:
 *   - "completed"   → notes = null
 *   - "failed"      → notes = "Call did not connect: <reason>."
 *   - "transferred" → notes = "Transferred to phone."
 *
 * Direction on the resulting row is always "outgoing" (the
 * `CALL_DIRECTIONS` convention); failed/transferred dispositions
 * don't remap to "missed" because that label is reserved for
 * inbound calls the user didn't pick up.
 */
export const RECORDED_CALL_DISPOSITIONS = ["completed", "failed", "transferred"] as const
export const recordedCallDispositionSchema = z.enum(RECORDED_CALL_DISPOSITIONS)
export type RecordedCallDisposition = z.infer<typeof recordedCallDispositionSchema>

/**
 * Input for `recordOutboundCall` — auto-logged from the dialer's
 * session_ended event. The action hard-codes direction to
 * "outgoing" and source to "ringcentral"; those are NOT client
 * inputs. `contactId` is optional because the dialer's public
 * `startCall` API permits dialing without a contact context
 * (future free-form dial input); V1 call sites always pass it.
 * `externalId` is null for V1; the 3b inbound-call webhook will
 * supply the real RC call id.
 */
export const recordOutboundCallInput = z.object({
  contactId: z.string().min(1).nullable().optional(),
  phoneNumber: z.string().min(1).max(64),
  startedAt: z.iso.datetime(),
  durationSeconds: z.number().int().min(0).max(86_400),
  disposition: recordedCallDispositionSchema,
  reason: z.string().max(1000).nullable().optional(),
  externalId: z.string().nullable().optional(),
})

export type LogCallInput = z.infer<typeof logCallInput>
export type UpdateCallInput = z.infer<typeof updateCallInput>
export type DeleteCallInput = z.infer<typeof deleteCallInput>
export type RecordOutboundCallInput = z.infer<typeof recordOutboundCallInput>
