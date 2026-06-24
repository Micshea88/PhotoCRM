import { z } from "zod"

/**
 * Meeting outcome taxonomy — Mike-locked 2026-06-21, grounded in HubSpot's
 * default meeting outcomes (Scheduled / Completed / Canceled / No show /
 * Rescheduled). Stored in `meetings.outcome` (text, nullable); null = not set.
 *
 * Plain-English display labels (rule #11) double as the stored-value casing —
 * the column holds the exact label string so the activity feed + filter render
 * it directly without a lookup table.
 */
export const MEETING_OUTCOMES = [
  "Scheduled",
  "Completed",
  "Canceled",
  "No show",
  "Rescheduled",
] as const
export const meetingOutcomeSchema = z.enum(MEETING_OUTCOMES)
export type MeetingOutcome = z.infer<typeof meetingOutcomeSchema>
