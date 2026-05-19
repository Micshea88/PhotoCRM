import "server-only"
import { and, eq, ilike, isNull, or, sql } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { contacts } from "./schema"
import { companies } from "@/modules/companies/schema"

interface ListOptions {
  withDeleted?: boolean
}

/**
 * All non-deleted contacts for the active org, ordered by last_name. RLS
 * scopes to org; no manual org_id filter. Caller passes `withDeleted: true`
 * to include tombstones (admin tooling only).
 */
export async function listContactsForOrg(opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(contacts)
      .where(opts.withDeleted ? undefined : isNull(contacts.deletedAt))
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
 * name so the caller can build the standard `"Last, First — Company"`
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
