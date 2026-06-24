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
 * Unified call disposition taxonomy — declared here (before
 * `logCallInput` and `updateCallInput`) so those zod inputs can
 * reference `recordedCallDispositionSchema`. The full HubSpot-aligned
 * value set + display labels are documented near the bottom of this
 * file (search for `DISPOSITION_DISPLAY`) since they're tightly
 * coupled to the auto-log `recordOutboundCallInput` block there.
 */
export const RECORDED_CALL_DISPOSITIONS = [
  "completed",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
  "transferred",
  "voicemail",
  "wrong_number",
] as const
export const recordedCallDispositionSchema = z.enum(RECORDED_CALL_DISPOSITIONS)
export type RecordedCallDisposition = z.infer<typeof recordedCallDispositionSchema>

const DISPOSITION_DISPLAY: Record<RecordedCallDisposition, string> = {
  completed: "Connected",
  no_answer: "No Answer",
  busy: "Busy",
  failed: "Failed",
  cancelled: "Cancelled",
  transferred: "Transferred",
  voicemail: "Left Voicemail",
  wrong_number: "Wrong Number",
}

export function dispositionDisplayLabel(d: RecordedCallDisposition): string {
  return DISPOSITION_DISPLAY[d]
}

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
  /**
   * Optional disposition. Manual logCall entries from the updated
   * composer pass one of the user-selectable values (completed /
   * no_answer / busy / voicemail / wrong_number). Older call sites
   * that don't supply this field continue to work (disposition stays
   * NULL on the row; activity feed renders no badge).
   */
  disposition: recordedCallDispositionSchema.nullable().optional(),
  // Optional event (project) / opportunity association.
  projectId: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
})

export const updateCallInput = z.object({
  id: z.string().min(1),
  startedAt: z.iso.datetime().optional(),
  direction: callDirectionSchema.optional(),
  durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  recordingFileId: z.string().nullable().optional(),
  disposition: recordedCallDispositionSchema.nullable().optional(),
  projectId: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
})

export const deleteCallInput = z.object({ id: z.string().min(1) })

/**
 * Unified call disposition taxonomy. Anchored to HubSpot's default
 * call outcomes (Connected / Busy / No answer / Left voicemail /
 * Wrong number) plus three system-only values the WebPhone SDK can
 * derive on its own (cancelled / failed / transferred).
 *
 * **Eight values total**, well within the 15-20 best-practice
 * ceiling for disposition taxonomies. All eight are storable in
 * `call_log.disposition`. Different code paths can write the same
 * value:
 *
 * | Value           | Source: dialer auto-log         | Source: manual logCall |
 * |-----------------|----------------------------------|------------------------|
 * | `completed`     | answered + normal hangup         | user selects "Connected"
 * | `no_answer`     | SIP 408 / 480, or 487 with ring ≥ 3s | user selects "No answer"
 * | `busy`          | SIP 486 Busy Here                | user selects "Busy"
 * | `failed`        | SIP 4xx-5xx (non-busy / non-no-answer), or network error | (not user-selectable in V1)
 * | `cancelled`     | SIP 487 with ring < 3s (rapid hangup) | (not user-selectable in V1)
 * | `transferred`   | explicit `reason="transferred"` from the SDK transfer success path | (not user-selectable in V1)
 * | `voicemail`     | (NEVER auto-classified — voicemail systems answer with 200 OK; SDK can't distinguish) | user selects "Left voicemail"
 * | `wrong_number`  | (NEVER auto-classified — judgment call) | user selects "Wrong number"
 *
 * **Direction on the resulting row is always `"outgoing"` for
 * dialer auto-log calls**, regardless of disposition. The
 * `CALL_DIRECTIONS` enum's `"missed"` value is reserved for inbound
 * calls the user didn't pick up — a no_answer outbound is still
 * `direction="outgoing"` + `disposition="no_answer"`.
 *
 * Display labels (`dispositionDisplayLabel`) match HubSpot's
 * user-facing copy for cross-tool familiarity:
 *
 *   completed     → "Connected"
 *   no_answer     → "No Answer"
 *   busy          → "Busy"
 *   failed        → "Failed"
 *   cancelled     → "Cancelled"
 *   transferred   → "Transferred"
 *   voicemail     → "Left Voicemail"
 *   wrong_number  → "Wrong Number"
 *
 * The activity feed renders a color-coded badge; null disposition
 * (pre-2026-06-11 manual rows) renders no badge.
 *
 * (The actual enum + display map declarations live near the top of
 * this file — necessary forward declaration so `logCallInput` and
 * `updateCallInput` zod schemas above can reference them.)
 */

/**
 * Input for `recordOutboundCall` — auto-logged from the dialer's
 * session_ended event. The action hard-codes direction to
 * "outgoing" and source to "ringcentral"; those are NOT client
 * inputs. `contactId` is optional because the dialer's public
 * `startCall` API permits dialing without a contact context
 * (future free-form dial input); V1 call sites always pass it.
 * `externalId` is null for V1; the 3b inbound-call webhook will
 * supply the real RC call id. `reason` is the raw SIP response line
 * from the SDK's `failed` event (e.g., `"SIP/2.0 486 Busy Here"`) —
 * preserved in `external_metadata.reason` for debugging even though
 * the classifier already used it to derive `disposition`.
 */
export const recordOutboundCallInput = z.object({
  contactId: z.string().min(1).nullable().optional(),
  phoneNumber: z.string().min(1).max(64),
  startedAt: z.iso.datetime(),
  durationSeconds: z.number().int().min(0).max(86_400),
  disposition: recordedCallDispositionSchema,
  reason: z.string().max(1000).nullable().optional(),
  externalId: z.string().nullable().optional(),
  // Telephony session id from the SDK — the RC-sync Layer-2 precise
  // reconciliation key (Rule 0). Null when the SDK didn't surface one.
  telephonySessionId: z.string().max(128).nullable().optional(),
})

/**
 * Input for `recordInboundCall` — auto-logged from the dialer's
 * inbound-call lifecycle (3b inbound answer UI). The action hard-codes
 * direction to "incoming" and source to "ringcentral"; those are NOT
 * client inputs. Same field shape as `recordOutboundCallInput`.
 *
 * Two write paths feed this:
 *   - Answered inbound that later ends → `disposition` is the
 *     classifier's verdict (duration-based), `durationSeconds` is the
 *     talk time.
 *   - Declined / missed (caller hung up before answer) → `disposition`
 *     is hard-coded `"no_answer"` with `durationSeconds: 0`. Per the
 *     approved Option A, these are written ONLY when the caller matched
 *     a known contact (so `contactId` is always set on that path); an
 *     unknown-number decline writes no row.
 */
export const recordInboundCallInput = z.object({
  contactId: z.string().min(1).nullable().optional(),
  phoneNumber: z.string().min(1).max(64),
  startedAt: z.iso.datetime(),
  durationSeconds: z.number().int().min(0).max(86_400),
  disposition: recordedCallDispositionSchema,
  reason: z.string().max(1000).nullable().optional(),
  externalId: z.string().nullable().optional(),
  // Telephony session id from the SDK — the RC-sync Layer-2 precise
  // reconciliation key (Rule 0). Null when the SDK didn't surface one.
  telephonySessionId: z.string().max(128).nullable().optional(),
})

export type LogCallInput = z.infer<typeof logCallInput>
export type UpdateCallInput = z.infer<typeof updateCallInput>
export type DeleteCallInput = z.infer<typeof deleteCallInput>
export type RecordOutboundCallInput = z.infer<typeof recordOutboundCallInput>
export type RecordInboundCallInput = z.infer<typeof recordInboundCallInput>
