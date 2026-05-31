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
  // P3 (C6c followup) — bi-directional sort. Whitelisted via
  // SORTABLE_CONTACT_FIELDS below; unknown values fall back to the
  // default (lastName asc). URL-param-driven on /contacts and
  // encoded in saved_views.sort jsonb (already supports
  // { field, direction }).
  sortBy?: string
  sortDir?: "asc" | "desc"
}

/**
 * Push 3 (C6c followup) — whitelist of sortable contact fields. The
 * keys are the column ids surfaced in CONTACT_COLUMN_REGISTRY; the
 * value is the SQL expression to order by. Add a row here when a
 * new sortable column ships.
 *
 * Custom-field columns aren't in this list (yet) — sorting on a
 * jsonb extracted value needs per-field-type casting (number vs
 * date vs text). Tracking that as a follow-up.
 */
export const SORTABLE_CONTACT_FIELDS = [
  "firstName",
  "lastName",
  "primaryEmail",
  "primaryPhone",
  "contactType",
  "lifecycleStatus",
  "leadSource",
  "companyName",
  "createdAt",
  "updatedAt",
] as const
export type SortableContactField = (typeof SORTABLE_CONTACT_FIELDS)[number]

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
  return withOrgContext((tx) => listContactsForViewWithDb(tx, filters, opts))
}

type TxHandle = Parameters<Parameters<typeof withOrgContext>[0]>[0]

/**
 * Push 3 (C6c followup) — parametric variant for callers that already
 * own a tx (integration tests on `withTestDb`'s transaction, or
 * future jobs that manage their own boundaries). The production
 * `listContactsForView` delegates to this; both code paths share the
 * WHERE + ORDER BY building so test behavior matches prod.
 */
export async function listContactsForViewWithDb(
  tx: TxHandle,
  filters: ContactFilterOverrides,
  opts: ListContactsForViewOptions = {},
): Promise<ListContactsForViewResult> {
  const pageSize: ContactsPageSize = opts.pageSize ?? CONTACTS_DEFAULT_PAGE_SIZE
  const page = Math.max(1, opts.page ?? 1)
  const offset = (page - 1) * pageSize
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

  const orderClauses = buildOrderClauses(filters)
  const rows = await tx
    .select({ contact: contacts, company: companies })
    .from(contacts)
    .leftJoin(companies, and(eq(contacts.companyId, companies.id), isNull(companies.deletedAt)))
    .where(and(...conditions))
    .orderBy(...orderClauses)
    .limit(pageSize)
    .offset(offset)

  return { rows, totalCount, cappedOut: false }
}

/**
 * Push 3 (C6c followup) — translate { sortBy, sortDir } from
 * ContactFilterOverrides into the SQL ORDER BY clauses.
 *
 * Whitelisted via SORTABLE_CONTACT_FIELDS; unknown sortBy values fall
 * back to the default (lastName asc, firstName asc) so URL drift
 * (typo, deprecated column) can't blow up the list. Direction
 * defaults to asc when missing.
 *
 * Secondary tie-break: when sorting on a column that isn't the name
 * pair, append (lastName, firstName) so equal-by-primary-sort rows
 * still come out in a stable alphabetic order.
 */
function buildOrderClauses(filters: ContactFilterOverrides): SQL[] {
  const dir = filters.sortDir === "desc" ? "desc" : "asc"
  const requested = filters.sortBy
  const isValid = !!requested && (SORTABLE_CONTACT_FIELDS as readonly string[]).includes(requested)
  if (!isValid) {
    return [sql`${contacts.lastName} asc`, sql`${contacts.firstName} asc`]
  }
  const dirSql = dir === "desc" ? sql`desc` : sql`asc`
  const nullsLastTrailer = dir === "desc" ? sql`nulls last` : sql`nulls last`
  function ordered(col: SQL): SQL {
    return sql`${col} ${dirSql} ${nullsLastTrailer}`
  }
  let primary: SQL
  switch (requested as SortableContactField) {
    case "firstName":
      primary = ordered(sql`${contacts.firstName}`)
      break
    case "lastName":
      primary = ordered(sql`${contacts.lastName}`)
      break
    case "primaryEmail":
      primary = ordered(sql`${contacts.primaryEmail}`)
      break
    case "primaryPhone":
      // Phone sort uses the digits-only normalized form so " (555) "
      // and "555-" group together.
      primary = ordered(sql`REGEXP_REPLACE(COALESCE(${contacts.primaryPhone}, ''), '\\D', '', 'g')`)
      break
    case "contactType":
      primary = ordered(sql`${contacts.contactType}`)
      break
    case "lifecycleStatus":
      primary = ordered(sql`${contacts.lifecycleStatus}`)
      break
    case "leadSource":
      primary = ordered(sql`${contacts.leadSource}`)
      break
    case "companyName":
      primary = ordered(sql`${companies.name}`)
      break
    case "createdAt":
      primary = ordered(sql`${contacts.createdAt}`)
      break
    case "updatedAt":
      primary = ordered(sql`${contacts.updatedAt}`)
      break
  }
  // Stable secondary tie-break. Skip when the primary IS the
  // (lastName, firstName) pair so we don't repeat ourselves.
  if (requested === "lastName") {
    return [primary, sql`${contacts.firstName} asc`]
  }
  if (requested === "firstName") {
    return [primary, sql`${contacts.lastName} asc`]
  }
  return [primary, sql`${contacts.lastName} asc`, sql`${contacts.firstName} asc`]
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
    // Push 4 followup — Drizzle binds a JS `string[]` as a quoted
    // scalar (e.g. `"Photographer"`), so `${filters.tags}::text[]`
    // fails with PG `22P02 malformed array literal` (array values
    // must start with `{`). Build the postgres array explicitly so
    // each tag lands as its own bound text parameter inside an
    // `ARRAY[...]::text[]` literal — `&&` (overlap) then matches
    // any contact whose tag column shares at least one element.
    const tagParams = sql.join(
      filters.tags.map((t) => sql`${t}`),
      sql`, `,
    )
    push(sql`${contacts.tags} && ARRAY[${tagParams}]::text[]`)
  }
  if (filters.createdFrom) push(sql`${contacts.createdAt} >= ${filters.createdFrom}::date`)
  if (filters.createdTo) {
    push(sql`${contacts.createdAt} < (${filters.createdTo}::date + INTERVAL '1 day')`)
  }
  if (filters.q && filters.q.trim().length > 0) {
    // P3 (C6c followup) — global search across ALL columns + tags +
    // custom_fields. Per Mike's spec: "search must cover ALL columns
    // + all custom fields". Implementation notes:
    //   - Phone fields ILIKE on a digits-only variant so the typed
    //     term "(555) 123-4567" matches the stored "5551234567" and
    //     vice versa.
    //   - tags is text[] — `EXISTS (SELECT 1 FROM unnest(tags) tag
    //     WHERE tag ILIKE pattern)` works against the GIN index for
    //     containment and falls back to a small array seq scan
    //     otherwise. Cheap at V1 scale.
    //   - custom_fields is jsonb — `custom_fields::text ILIKE`
    //     casts the whole document to text and substring-matches.
    //     This won't use the existing GIN-on-jsonb index (that index
    //     is for @> containment). It WILL force a seq scan against
    //     the jsonb column. Acceptable because CONTACTS_LIST_HARD_CAP
    //     (10k) bounds the scan.
    //
    // V1.5 root-cause fix (not in this commit — proposed for when
    // contact volumes outgrow the 10k cap):
    //   CREATE EXTENSION IF NOT EXISTS pg_trgm;
    //   CREATE INDEX contacts_search_trgm_idx ON contacts
    //     USING gin ((
    //       coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' ||
    //       coalesce(primary_email,'') || ' ' || coalesce(secondary_email,'') || ' ' ||
    //       coalesce(primary_phone,'') || ' ' || coalesce(secondary_phone,'') || ' ' ||
    //       coalesce(notes,'') || ' ' || coalesce(custom_fields::text,'')
    //     ) gin_trgm_ops);
    // The expression above would let ILIKE %term% use the GIN index.
    const term = filters.q.trim()
    const pattern = `%${term}%`
    const digits = term.replace(/\D/g, "")
    const phonePattern = digits ? `%${digits}%` : pattern
    push(
      or(
        ilike(contacts.firstName, pattern),
        ilike(contacts.lastName, pattern),
        ilike(contacts.primaryEmail, pattern),
        ilike(contacts.secondaryEmail, pattern),
        ilike(contacts.primaryPhone, phonePattern),
        ilike(contacts.secondaryPhone, phonePattern),
        ilike(contacts.contactType, pattern),
        ilike(contacts.lifecycleStatus, pattern),
        ilike(contacts.leadSource, pattern),
        ilike(contacts.sourceDetail, pattern),
        ilike(contacts.notes, pattern),
        ilike(contacts.instagramHandle, pattern),
        ilike(contacts.facebookUrl, pattern),
        ilike(contacts.website, pattern),
        ilike(companies.name, pattern),
        sql`EXISTS (SELECT 1 FROM unnest(${contacts.tags}) tag WHERE tag ILIKE ${pattern})`,
        sql`${contacts.customFields}::text ILIKE ${pattern}`,
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
