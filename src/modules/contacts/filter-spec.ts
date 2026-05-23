import "server-only"
import { and, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { contacts } from "./schema"
import { companies } from "@/modules/companies/schema"
import { tasks } from "@/modules/tasks/schema"
import { projectContacts } from "@/modules/projects/schema"

// Re-export pagination constants from the client-safe pagination
// module so existing server-side imports keep working without bundling
// pg into the client.
export {
  CONTACTS_LIST_HARD_CAP,
  CONTACTS_VALID_PAGE_SIZES,
  CONTACTS_DEFAULT_PAGE_SIZE,
  type ContactsPageSize,
} from "./pagination"
import {
  CONTACTS_LIST_HARD_CAP,
  CONTACTS_DEFAULT_PAGE_SIZE,
  type ContactsPageSize,
} from "./pagination"

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
/**
 * Operator for a custom-field filter, paired with the field type that
 * produced it. Each entry comes from the More Filters drawer's
 * Custom Fields sub-panel; the action layer normalises them into URL
 * params on the client and re-parses here.
 */
export interface CustomFieldFilter {
  fieldId: string
  op: "contains" | "eq" | "in" | "min" | "max" | "from" | "to"
  value: string
}

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
  // Push 2b — "More filters" panel:
  hasPhone?: boolean
  hasEmail?: boolean
  lastActivityFrom?: string
  lastActivityTo?: string
  openTasksFrom?: string
  openTasksTo?: string
  customFields?: CustomFieldFilter[]
}

export interface ListContactsForViewOptions {
  /** 1-indexed page. Defaults to 1. */
  page?: number
  /** One of CONTACTS_VALID_PAGE_SIZES. Defaults to CONTACTS_DEFAULT_PAGE_SIZE. */
  pageSize?: ContactsPageSize
}

export interface ListContactsForViewResult {
  rows: Awaited<ReturnType<typeof _rawListContactsForView>>
  /** Total matching rows up to the CONTACTS_LIST_HARD_CAP cutoff. */
  totalCount: number
  /** True when the unfiltered match set crossed CONTACTS_LIST_HARD_CAP. */
  cappedOut: boolean
}

/**
 * Resolve filter overrides into a paginated contacts list (joined with
 * primary company) plus a total-count, both capped at
 * CONTACTS_LIST_HARD_CAP. RLS scopes to org; no manual org_id filter.
 *
 * Behavior:
 *   - Returns `pageSize` rows starting at `offset = (page - 1) * pageSize`.
 *   - Computes total count separately, also capped — using a COUNT
 *     over a LIMIT'd subquery so the planner never scans past 10k.
 *   - `cappedOut: true` ⇒ the underlying match set was ≥ 10k. The host
 *     should render the refine-filters banner instead of pagination.
 */
export async function listContactsForView(
  filters: ContactFilterOverrides,
  opts: ListContactsForViewOptions = {},
): Promise<ListContactsForViewResult> {
  const pageSize: ContactsPageSize = opts.pageSize ?? CONTACTS_DEFAULT_PAGE_SIZE
  const page = Math.max(1, opts.page ?? 1)
  const offset = (page - 1) * pageSize

  return withOrgContext(async (tx) => {
    const conditions = buildContactConditions(filters)

    // Cap the count at CONTACTS_LIST_HARD_CAP + 1 so we can detect
    // "exceeded the cap" without scanning the whole table. The +1
    // sentinel says: there's at least one more row past the cap.
    const cappedSubquery = sql`(
      SELECT 1
      FROM ${contacts}
      LEFT JOIN ${companies} ON ${contacts.companyId} = ${companies.id} AND ${companies.deletedAt} IS NULL
      WHERE ${and(...conditions)}
      LIMIT ${CONTACTS_LIST_HARD_CAP + 1}
    ) AS capped`

    const countResult = await tx.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total FROM ${cappedSubquery}
    `)
    const countRow = countResult.rows[0]
    const cappedTotal = countRow?.total ?? 0
    const cappedOut = cappedTotal > CONTACTS_LIST_HARD_CAP
    const totalCount = Math.min(cappedTotal, CONTACTS_LIST_HARD_CAP)

    if (cappedOut) {
      return { rows: [], totalCount, cappedOut }
    }

    const rows = await tx
      .select({ contact: contacts, company: companies })
      .from(contacts)
      .leftJoin(companies, and(eq(contacts.companyId, companies.id), isNull(companies.deletedAt)))
      .where(and(...conditions))
      .orderBy(contacts.lastName, contacts.firstName)
      .limit(pageSize)
      .offset(offset)

    return { rows, totalCount, cappedOut: false }
  })
}

// Re-typed helper for the result shape's inference (avoids a circular
// type reference inside the result interface itself). Used only as a
// type — the function never runs.
async function _rawListContactsForView() {
  return withOrgContext(async (tx) => {
    return tx
      .select({ contact: contacts, company: companies })
      .from(contacts)
      .leftJoin(companies, and(eq(contacts.companyId, companies.id), isNull(companies.deletedAt)))
      .limit(0)
  })
}

/**
 * Build the WHERE conditions shared by listContactsForView and the
 * cap-count subquery. Extracted so both code paths use exactly the
 * same predicate set; drift would skew the count.
 */
function buildContactConditions(filters: ContactFilterOverrides): SQL[] {
  const conditions: SQL[] = []
  const push = (s: SQL | undefined) => {
    if (s) conditions.push(s)
  }
  push(isNull(contacts.deletedAt))
  push(isNull(contacts.archivedAt))

  if (filters.contactType) push(eq(contacts.contactType, filters.contactType))
  if (filters.lifecycleStatus) push(eq(contacts.lifecycleStatus, filters.lifecycleStatus))
  if (filters.ownerUserId) push(eq(contacts.ownerUserId, filters.ownerUserId))
  if (filters.companyId) push(eq(contacts.companyId, filters.companyId))
  if (filters.leadSource) push(eq(contacts.leadSource, filters.leadSource))
  if (filters.tags && filters.tags.length > 0) {
    push(sql`${contacts.tags} && ${filters.tags}::text[]`)
  }
  if (filters.createdFrom) push(sql`${contacts.createdAt} >= ${filters.createdFrom}::date`)
  if (filters.createdTo) {
    push(sql`${contacts.createdAt} < (${filters.createdTo}::date + INTERVAL '1 day')`)
  }
  if (filters.q && filters.q.trim().length > 0) {
    const term = filters.q.trim()
    const pattern = `%${term}%`
    const digits = term.replace(/\D/g, "")
    const phonePattern = digits ? `%${digits}%` : pattern
    push(
      or(
        ilike(contacts.firstName, pattern),
        ilike(contacts.lastName, pattern),
        ilike(contacts.primaryEmail, pattern),
        ilike(contacts.primaryPhone, phonePattern),
        ilike(companies.name, pattern),
      ),
    )
  }

  // ── Push 2b — additional filters from the More filters drawer ──

  // Has Phone / Has Email — "set, not empty string". Existing rows use
  // null for "not provided"; create flows trim/coerce empty to null,
  // but legacy data could have whitespace — defensive AND NULLIF != ''.
  if (filters.hasPhone === true) {
    push(
      and(isNotNull(contacts.primaryPhone), sql`NULLIF(${contacts.primaryPhone}, '') IS NOT NULL`),
    )
  }
  if (filters.hasEmail === true) {
    push(
      and(isNotNull(contacts.primaryEmail), sql`NULLIF(${contacts.primaryEmail}, '') IS NOT NULL`),
    )
  }

  // Last Activity Date — V1 proxies updated_at.
  if (filters.lastActivityFrom) {
    push(sql`${contacts.updatedAt} >= ${filters.lastActivityFrom}::date`)
  }
  if (filters.lastActivityTo) {
    push(sql`${contacts.updatedAt} < (${filters.lastActivityTo}::date + INTERVAL '1 day')`)
  }

  // Open tasks — contacts whose linked projects have ≥1 open task with
  // a due date in the range.
  if (filters.openTasksFrom || filters.openTasksTo) {
    const fromSql = filters.openTasksFrom
      ? sql`AND t.due_date >= ${filters.openTasksFrom}::date`
      : sql``
    const toSql = filters.openTasksTo
      ? sql`AND t.due_date < (${filters.openTasksTo}::date + INTERVAL '1 day')`
      : sql``
    push(sql`EXISTS (
      SELECT 1
      FROM ${projectContacts} pc
      JOIN ${tasks} t ON t.project_id = pc.project_id
      WHERE pc.contact_id = ${contacts.id}
        AND t.status != 'done'
        AND t.deleted_at IS NULL
        ${fromSql} ${toSql}
    )`)
  }

  // Custom fields — values stored on contacts.custom_fields jsonb,
  // keyed by definition id. Each (fieldId, op) maps to a jsonb predicate.
  if (filters.customFields && filters.customFields.length > 0) {
    for (const f of filters.customFields) {
      const key = sql.raw(`'${f.fieldId.replace(/'/g, "''")}'`)
      switch (f.op) {
        case "contains":
          push(sql`${contacts.customFields} ->> ${key} ILIKE ${`%${f.value}%`}`)
          break
        case "eq":
          push(sql`${contacts.customFields} ->> ${key} = ${f.value}`)
          break
        case "in": {
          const values = f.value.split(",").filter(Boolean)
          if (values.length > 0) {
            push(sql`(${contacts.customFields} -> ${key}) ?| ${values}::text[]`)
          }
          break
        }
        case "min":
          push(sql`(${contacts.customFields} ->> ${key})::numeric >= ${Number(f.value)}`)
          break
        case "max":
          push(sql`(${contacts.customFields} ->> ${key})::numeric <= ${Number(f.value)}`)
          break
        case "from":
          push(sql`(${contacts.customFields} ->> ${key})::date >= ${f.value}::date`)
          break
        case "to":
          push(
            sql`(${contacts.customFields} ->> ${key})::date < (${f.value}::date + INTERVAL '1 day')`,
          )
          break
      }
    }
  }

  return conditions
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
