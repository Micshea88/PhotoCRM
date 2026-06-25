import "server-only"
import { and, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { withOrgContext } from "@/lib/org-context"
import type * as schema from "@/db/schema"
import { contacts, contactCompanyAssociations, contactNotes } from "./schema"
import { companies } from "@/modules/companies/schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Find the contact matching an email (case-insensitive, primary OR secondary
 * email), org-scoped by RLS. Returns the single most-recently-updated match —
 * emails are unique by design, but if an anomaly duplicates them, decision 1
 * (2026-06-24) picks the most-recent. Null when there's no match (inbound
 * caller then DROPS the email — decision 2). The tx-accepting form lets the
 * inbound webhook (manual server-to-server tx) reuse the exact lookup.
 */
export async function findContactByEmail(tx: DbHandle, email: string) {
  const lowered = email.trim().toLowerCase()
  if (!lowered) return null
  const [row] = await tx
    .select()
    .from(contacts)
    .where(
      and(
        isNull(contacts.deletedAt),
        or(
          eq(sql`lower(${contacts.primaryEmail})`, lowered),
          eq(sql`lower(${contacts.secondaryEmail})`, lowered),
        ),
      ),
    )
    .orderBy(sql`${contacts.updatedAt} desc`)
    .limit(1)
  return row ?? null
}

export async function getContactByEmail(email: string) {
  return withOrgContext((tx) => findContactByEmail(tx, email))
}

interface ListOptions {
  withDeleted?: boolean
  /** Include archived contacts. Defaults to false — archived rows
   * surface only on /contacts/archived. */
  withArchived?: boolean
}

/**
 * All non-deleted, non-archived contacts for the active org, ordered
 * by last_name. RLS scopes to org; no manual org_id filter. Caller
 * passes `withDeleted` / `withArchived` to broaden.
 */
export async function listContactsForOrg(opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const conds = []
    if (!opts.withDeleted) conds.push(isNull(contacts.deletedAt))
    if (!opts.withArchived) conds.push(isNull(contacts.archivedAt))
    return tx
      .select()
      .from(contacts)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(contacts.lastName, contacts.firstName)
  })
}

/**
 * Single contact + its company (left join so contacts without a company
 * still return). The join is on (contact.companyId = company.id AND
 * company NOT deleted) so a soft-deleted company doesn't surface its
 * orphaned name into the contact display.
 */
export async function getContactForOrg(id: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(contacts.id, id)
      : and(eq(contacts.id, id), isNull(contacts.deletedAt))
    const [row] = await tx
      .select({
        contact: contacts,
        company: companies,
      })
      .from(contacts)
      .leftJoin(companies, and(eq(contacts.companyId, companies.id), isNull(companies.deletedAt)))
      .where(where)
      .limit(1)
    return row ?? null
  })
}

/**
 * Typeahead / unified search: matches name (first OR last) and primary
 * email. Case-insensitive `ILIKE %q%`. Result includes the joined company
 * name so the caller can build the standard `"First Last — Company"`
 * label without a follow-up query.
 */
export async function searchContactsByName(q: string, limit = 10) {
  return withOrgContext(async (tx) => {
    const pattern = `%${q}%`
    return tx
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        primaryEmail: contacts.primaryEmail,
        companyName: companies.name,
      })
      .from(contacts)
      .leftJoin(companies, and(eq(contacts.companyId, companies.id), isNull(companies.deletedAt)))
      .where(
        and(
          isNull(contacts.deletedAt),
          or(
            ilike(contacts.firstName, pattern),
            ilike(contacts.lastName, pattern),
            ilike(contacts.primaryEmail, pattern),
          ),
        ),
      )
      .orderBy(contacts.lastName, contacts.firstName)
      .limit(limit)
  })
}

/**
 * All contacts at one company. Powers the "5 contacts at Evergreen
 * Planning" rollup the Vendor Matrix module will render.
 */
export async function listContactsByCompany(companyId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.companyId, companyId), isNull(contacts.deletedAt)))
      .orderBy(contacts.lastName, contacts.firstName)
  })
}

/**
 * Filtered by contact_type. The (org, contact_type, deleted_at) index
 * covers it. Powers list views like "all Vendors" without scanning the
 * full contact table.
 */
export async function listContactsByType(contactType: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.contactType, contactType), isNull(contacts.deletedAt)))
      .orderBy(contacts.lastName, contacts.firstName)
  })
}

/**
 * Tag-based filter. `contacts.tags @> ARRAY[tag]` uses the GIN index for
 * a fast containment scan. Pass multiple tags for AND semantics, or
 * change `@>` to `&&` for OR-overlap if needed in the saved-views engine.
 */
export async function listContactsByTags(tags: string[]) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(contacts)
      .where(and(sql`${contacts.tags} @> ${tags}::text[]`, isNull(contacts.deletedAt)))
      .orderBy(contacts.lastName, contacts.firstName)
  })
}

/**
 * Soft-deleted contacts (trash view). Same shape as listContactsForOrg
 * but inverts the deletedAt filter and orders by most-recently-deleted
 * first so the trash UI shows the latest tombstones at the top.
 *
 * Push 4 (B2) — also surfaces a `mergedIntoWinnerId` per row: the id
 * of the live contact whose `merged_record_ids` jsonb contains this
 * row's id (= "this contact was a merge loser"). The Restore button
 * uses it to show the spec-mandated warning before restoring a
 * merged-loser as a separate record.
 *
 * The LEFT JOIN uses the jsonb `?` operator (key-exists for arrays of
 * scalars). The candidate set is bounded to the same org + active
 * (non-deleted) winners — a winner that was itself later merged
 * into yet another record would also be deleted, so the lookup
 * naturally truncates to the most-recent surviving winner.
 */
export async function listDeletedContactsForOrg() {
  return withOrgContext(async (tx) => {
    const rows = await tx.execute<{
      id: string
      first_name: string
      last_name: string
      primary_email: string | null
      primary_phone: string | null
      deleted_at: Date
      merged_into_winner_id: string | null
    }>(sql`
      SELECT
        d.id, d.first_name, d.last_name, d.primary_email, d.primary_phone, d.deleted_at,
        w.id AS merged_into_winner_id
      FROM ${contacts} d
      LEFT JOIN ${contacts} w
        ON w.organization_id = d.organization_id
        AND w.deleted_at IS NULL
        AND w.merged_record_ids ? d.id
      WHERE d.deleted_at IS NOT NULL
      ORDER BY d.deleted_at DESC NULLS LAST
    `)
    return rows.rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      primaryEmail: r.primary_email,
      primaryPhone: r.primary_phone,
      deletedAt: r.deleted_at,
      mergedIntoWinnerId: r.merged_into_winner_id,
    }))
  })
}

/**
 * Archived contacts — separate from deleted. Returns active (non-deleted)
 * contacts where `archived_at IS NOT NULL`, most-recently-archived first.
 * Powers /contacts/archived.
 */
export async function listArchivedContactsForOrg() {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(contacts)
      .where(and(isNotNull(contacts.archivedAt), isNull(contacts.deletedAt)))
      .orderBy(sql`${contacts.archivedAt} DESC NULLS LAST`)
  })
}

// ─── Contact notes (P4.2) ─────────────────────────────────────────────

/**
 * Time-stamped notes for one contact, most recent first.
 * Soft-deleted notes are excluded.
 */
export async function listContactNotes(contactId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(contactNotes)
      .where(and(eq(contactNotes.contactId, contactId), isNull(contactNotes.deletedAt)))
      .orderBy(sql`${contactNotes.createdAt} DESC`)
  })
}

// ─── Contact ↔ company associations (P4.2) ─────────────────────────────

/**
 * All additional company associations for a contact (excluding the
 * primary contacts.company_id, which the caller renders separately).
 * Joined with companies so the caller has the company name + slug for
 * display without a follow-up query.
 */
export async function listContactCompanyAssociations(contactId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select({
        association: contactCompanyAssociations,
        company: companies,
      })
      .from(contactCompanyAssociations)
      .innerJoin(companies, eq(contactCompanyAssociations.companyId, companies.id))
      .where(and(eq(contactCompanyAssociations.contactId, contactId), isNull(companies.deletedAt)))
      .orderBy(contactCompanyAssociations.createdAt)
  })
}
