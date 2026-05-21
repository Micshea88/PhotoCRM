import "server-only"
import { and, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { contacts } from "./schema"
import { companies } from "@/modules/companies/schema"

/**
 * Active filter overrides for /contacts list. These come from URL search
 * params (the source of truth for "what's filtered right now") and are
 * applied on top of the active saved view's persisted filters.
 *
 * PUSH 2a renders only the "All Contacts" view (filters: []), so for
 * now overrides ARE the entire filter set. PUSH 2b will add the merge
 * step (saved.filters + overrides → applied filters).
 *
 * Field semantics:
 *   - `q`           — single search term, applied across firstName,
 *                     lastName, primaryEmail, primaryPhone, company name.
 *                     If the term contains digits, the phone comparison
 *                     normalizes to digits-only before matching (so
 *                     "(555) 123-4567" matches the stored "5551234567").
 *   - `contactType` — exact match against contacts.contact_type.
 *   - `lifecycleStatus` — exact match.
 *   - `tags`        — multi-value; matches contacts whose tags array
 *                     OVERLAPS the supplied list (`tags && ARRAY[...]`).
 *                     OR semantics: tag a OR tag b matches.
 *   - `ownerUserId` — exact match.
 *   - `companyId`   — exact match against the PRIMARY company FK only.
 *                     Additional associations are NOT searched here —
 *                     that's a future "any of associations" filter.
 *   - `leadSource`  — exact match.
 *   - `createdFrom` / `createdTo` — inclusive date range against
 *                     contacts.created_at. `createdTo` is interpreted
 *                     as end-of-day (the SQL adds 1 day and uses `<`).
 */
export interface ContactFilterOverrides {
  q?: string
  contactType?: string
  lifecycleStatus?: string
  tags?: string[]
  ownerUserId?: string
  companyId?: string
  leadSource?: string
  createdFrom?: string
  createdTo?: string
}

/**
 * Resolve filter overrides into a contacts list (joined with primary
 * company). RLS scopes to org; no manual org_id filter.
 *
 * Hard cap of 500 rows in V1 — pagination ships in a later push when
 * we hit the limit in practice. Until then, 500 is enough headroom for
 * any single-photographer studio's contact list.
 */
export async function listContactsForView(filters: ContactFilterOverrides) {
  return withOrgContext(async (tx) => {
    const conditions: (SQL | undefined)[] = [isNull(contacts.deletedAt)]

    if (filters.contactType) {
      conditions.push(eq(contacts.contactType, filters.contactType))
    }
    if (filters.lifecycleStatus) {
      conditions.push(eq(contacts.lifecycleStatus, filters.lifecycleStatus))
    }
    if (filters.ownerUserId) {
      conditions.push(eq(contacts.ownerUserId, filters.ownerUserId))
    }
    if (filters.companyId) {
      conditions.push(eq(contacts.companyId, filters.companyId))
    }
    if (filters.leadSource) {
      conditions.push(eq(contacts.leadSource, filters.leadSource))
    }
    if (filters.tags && filters.tags.length > 0) {
      conditions.push(sql`${contacts.tags} && ${filters.tags}::text[]`)
    }
    if (filters.createdFrom) {
      conditions.push(sql`${contacts.createdAt} >= ${filters.createdFrom}::date`)
    }
    if (filters.createdTo) {
      conditions.push(sql`${contacts.createdAt} < (${filters.createdTo}::date + INTERVAL '1 day')`)
    }
    if (filters.q && filters.q.trim().length > 0) {
      const term = filters.q.trim()
      const pattern = `%${term}%`
      const digits = term.replace(/\D/g, "")
      const phonePattern = digits ? `%${digits}%` : pattern
      conditions.push(
        or(
          ilike(contacts.firstName, pattern),
          ilike(contacts.lastName, pattern),
          ilike(contacts.primaryEmail, pattern),
          ilike(contacts.primaryPhone, phonePattern),
          ilike(companies.name, pattern),
        ),
      )
    }

    return tx
      .select({ contact: contacts, company: companies })
      .from(contacts)
      .leftJoin(companies, and(eq(contacts.companyId, companies.id), isNull(companies.deletedAt)))
      .where(and(...conditions))
      .orderBy(contacts.lastName, contacts.firstName)
      .limit(500)
  })
}

/**
 * Distinct tag values present on any non-deleted contact in the org.
 * Used to populate the Tags filter chip's multi-select. Unnesting the
 * `text[]` column and grouping is cheap in V1 scale; if the contact
 * list grows large enough that this becomes a hotspot, materialize
 * into a per-org `tag_index` table.
 */
export async function listDistinctContactTags(): Promise<string[]> {
  return withOrgContext(async (tx) => {
    const rows = await tx.execute<{ tag: string }>(sql`
      SELECT DISTINCT unnest(${contacts.tags}) AS tag
      FROM ${contacts}
      WHERE ${contacts.deletedAt} IS NULL
        AND ${contacts.tags} IS NOT NULL
      ORDER BY tag
    `)
    return rows.rows.map((r) => r.tag).filter((t) => t !== "")
  })
}

/**
 * Distinct non-null lead-source values currently in use. Powers the
 * Lead Source filter chip dropdown so the user picks from real values
 * rather than free-form typing.
 */
export async function listDistinctContactLeadSources(): Promise<string[]> {
  return withOrgContext(async (tx) => {
    const rows = await tx
      .selectDistinct({ leadSource: contacts.leadSource })
      .from(contacts)
      .where(and(isNull(contacts.deletedAt), sql`${contacts.leadSource} IS NOT NULL`))
      .orderBy(contacts.leadSource)
    return rows.map((r) => r.leadSource).filter((v): v is string => !!v)
  })
}
