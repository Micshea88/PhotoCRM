/**
 * Push 3 (C4) — pure types + label helpers for the pre-write dedup
 * flow. Lives separately from dedup-preflight.ts (which is
 * server-only because it queries the DB) so the contact form's
 * DedupBlockModal can import these symbols on the client without
 * pulling in the server boundary.
 */

export type DedupMatchField = "primaryEmail" | "secondaryEmail" | "primaryPhone" | "secondaryPhone"

export interface DedupMatch {
  matchedContactId: string
  matchedField: DedupMatchField
}

/**
 * Human-readable label for a DedupMatchField. Used by the
 * DedupBlockModal so the message reads "...by primary email" rather
 * than the raw enum.
 */
export function dedupFieldLabel(field: DedupMatchField): string {
  switch (field) {
    case "primaryEmail":
      return "primary email"
    case "secondaryEmail":
      return "secondary email"
    case "primaryPhone":
      return "primary phone"
    case "secondaryPhone":
      return "secondary phone"
  }
}
