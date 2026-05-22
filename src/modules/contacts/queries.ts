import "server-only"
import { and, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { contacts, contactCompanyAssociations, contactNotes } from "./schema"
import { companies } from "@/modules/companies/schema"

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
 */
export async function listDeletedContactsForOrg() {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(contacts)
      .where(sql`${contacts.deletedAt} IS NOT NULL`)
      .orderBy(sql`${contacts.deletedAt} DESC NULLS LAST`)
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
