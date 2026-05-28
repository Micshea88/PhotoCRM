import "server-only"
import { and, eq, isNull, ne, or, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { contacts } from "./schema"
import { normalizePhone } from "./import-spec"
import type { DedupMatch, DedupMatchField } from "./dedup-types"

export type { DedupMatch, DedupMatchField } from "./dedup-types"
export { dedupFieldLabel } from "./dedup-types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Push 3 (C4) — pre-write dedup hard block.
 *
 * Given a candidate contact's primary/secondary email + primary/secondary
 * phone (any may be null), search the active org for an existing
 * non-soft-deleted contact that matches on:
 *   - normalized email (lowercase trimmed) on EITHER primary OR
 *     secondary email of an existing contact
 *   - normalized phone (digits-only) on EITHER primary OR secondary
 *     phone of an existing contact
 *
 * The first match wins; the field is reported back so the host can
 * tell the user WHICH field collided. Order: primary email →
 * secondary email → primary phone → secondary phone.
 *
 * `excludeContactId` is used by updateContact to skip self.
 *
 * Returns null when no match. RLS scopes to org via the existing
 * orgAction context — no manual org_id filter needed but we add one
 * defensively to match the rest of the contacts queries.
 */
interface PreflightInput {
  primaryEmail?: string | null
  secondaryEmail?: string | null
  primaryPhone?: string | null
  secondaryPhone?: string | null
  excludeContactId?: string | null
}

function lower(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export async function findDedupConflict(
  db: DbHandle,
  orgId: string,
  input: PreflightInput,
): Promise<DedupMatch | null> {
  const primaryEmailLower = lower(input.primaryEmail)
  const secondaryEmailLower = lower(input.secondaryEmail)
  const primaryPhoneDigits = normalizePhone(input.primaryPhone ?? null)
  const secondaryPhoneDigits = normalizePhone(input.secondaryPhone ?? null)

  const haveAnything =
    primaryEmailLower !== null ||
    secondaryEmailLower !== null ||
    primaryPhoneDigits !== null ||
    secondaryPhoneDigits !== null
  if (!haveAnything) return null

  // Build OR-clauses for each non-null candidate value. SQL operates on
  // LOWER(primary_email)/LOWER(secondary_email) for emails and
  // REGEXP_REPLACE(phone, '\D', '', 'g') for phones — matches the
  // partial unique index expressions in migration 0034.
  const conditions = []
  if (primaryEmailLower !== null) {
    conditions.push(
      sql`LOWER(${contacts.primaryEmail}) = ${primaryEmailLower}`,
      sql`LOWER(${contacts.secondaryEmail}) = ${primaryEmailLower}`,
    )
  }
  if (secondaryEmailLower !== null) {
    conditions.push(
      sql`LOWER(${contacts.primaryEmail}) = ${secondaryEmailLower}`,
      sql`LOWER(${contacts.secondaryEmail}) = ${secondaryEmailLower}`,
    )
  }
  if (primaryPhoneDigits !== null) {
    conditions.push(
      sql`REGEXP_REPLACE(COALESCE(${contacts.primaryPhone}, ''), '\\D', '', 'g') = ${primaryPhoneDigits}`,
      sql`REGEXP_REPLACE(COALESCE(${contacts.secondaryPhone}, ''), '\\D', '', 'g') = ${primaryPhoneDigits}`,
    )
  }
  if (secondaryPhoneDigits !== null) {
    conditions.push(
      sql`REGEXP_REPLACE(COALESCE(${contacts.primaryPhone}, ''), '\\D', '', 'g') = ${secondaryPhoneDigits}`,
      sql`REGEXP_REPLACE(COALESCE(${contacts.secondaryPhone}, ''), '\\D', '', 'g') = ${secondaryPhoneDigits}`,
    )
  }

  // Empty input was guarded above; conditions is non-empty here.
  const baseWhere = and(
    eq(contacts.organizationId, orgId),
    isNull(contacts.deletedAt),
    or(...conditions),
  )

  const where = input.excludeContactId
    ? and(baseWhere, ne(contacts.id, input.excludeContactId))
    : baseWhere

  // Pull a single matching row plus the matched fields so we can report
  // the most-specific conflict field to the user.
  const [row] = await db
    .select({
      id: contacts.id,
      primaryEmail: contacts.primaryEmail,
      secondaryEmail: contacts.secondaryEmail,
      primaryPhone: contacts.primaryPhone,
      secondaryPhone: contacts.secondaryPhone,
    })
    .from(contacts)
    .where(where)
    .limit(1)

  if (!row) return null

  // Determine which input field collided. Preference order matches
  // the user's mental model: primary fields first.
  const rowPrimaryEmail = lower(row.primaryEmail)
  const rowSecondaryEmail = lower(row.secondaryEmail)
  const rowPrimaryPhone = normalizePhone(row.primaryPhone)
  const rowSecondaryPhone = normalizePhone(row.secondaryPhone)

  function emailMatchesRow(candidate: string | null): boolean {
    if (!candidate) return false
    return candidate === rowPrimaryEmail || candidate === rowSecondaryEmail
  }
  function phoneMatchesRow(candidate: string | null): boolean {
    if (!candidate) return false
    return candidate === rowPrimaryPhone || candidate === rowSecondaryPhone
  }

  let matchedField: DedupMatchField = "primaryEmail"
  if (primaryEmailLower !== null && emailMatchesRow(primaryEmailLower)) {
    matchedField = "primaryEmail"
  } else if (secondaryEmailLower !== null && emailMatchesRow(secondaryEmailLower)) {
    matchedField = "secondaryEmail"
  } else if (primaryPhoneDigits !== null && phoneMatchesRow(primaryPhoneDigits)) {
    matchedField = "primaryPhone"
  } else if (secondaryPhoneDigits !== null && phoneMatchesRow(secondaryPhoneDigits)) {
    matchedField = "secondaryPhone"
  }

  return { matchedContactId: row.id, matchedField }
}
