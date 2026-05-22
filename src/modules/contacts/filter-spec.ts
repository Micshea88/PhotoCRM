import "server-only"
import { and, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { contacts } from "./schema"
import { companies } from "@/modules/companies/schema"
import { tasks } from "@/modules/tasks/schema"
import { projectContacts } from "@/modules/projects/schema"

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
    const conditions: (SQL | undefined)[] = [
      isNull(contacts.deletedAt),
      isNull(contacts.archivedAt),
    ]

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

    // ── Push 2b — additional filters from the More filters drawer ──

    // Has Phone / Has Email — "set, not empty string". Existing rows use
    // null for "not provided"; create flows trim/coerce empty to null,
    // but legacy data could have whitespace — defensive AND NULLIF != ''.
    if (filters.hasPhone === true) {
      conditions.push(
        and(
          isNotNull(contacts.primaryPhone),
          sql`NULLIF(${contacts.primaryPhone}, '') IS NOT NULL`,
        ),
      )
    }
    if (filters.hasEmail === true) {
      conditions.push(
        and(
          isNotNull(contacts.primaryEmail),
          sql`NULLIF(${contacts.primaryEmail}, '') IS NOT NULL`,
        ),
      )
    }

    // Last Activity Date — V1 proxies updated_at. Future: when the
    // activity-log shipper lands, point this at the activity table's
    // (contact_id, occurred_at) most-recent. Documented in the More
    // filters panel as "Last activity (proxy: updated)".
    if (filters.lastActivityFrom) {
      conditions.push(sql`${contacts.updatedAt} >= ${filters.lastActivityFrom}::date`)
    }
    if (filters.lastActivityTo) {
      conditions.push(
        sql`${contacts.updatedAt} < (${filters.lastActivityTo}::date + INTERVAL '1 day')`,
      )
    }

    // Open tasks — contacts whose linked projects have ≥1 open task with
    // a due date in the range. Tasks have project_id (no direct
    // contact_id); the project_contacts join carries the relation.
    // "Open" = status != 'done' AND deleted_at IS NULL.
    if (filters.openTasksFrom || filters.openTasksTo) {
      const fromSql = filters.openTasksFrom
        ? sql`AND t.due_date >= ${filters.openTasksFrom}::date`
        : sql``
      const toSql = filters.openTasksTo
        ? sql`AND t.due_date < (${filters.openTasksTo}::date + INTERVAL '1 day')`
        : sql``
      conditions.push(sql`EXISTS (
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
    // keyed by definition id. The drawer encodes one filter per
    // (fieldId, op) into the URL; here we translate each into a SQL
    // predicate using jsonb operators. The custom-fields module is
    // the source of truth for legal ops per field type; we trust the
    // caller to send semantically-valid (fieldId, op) pairs.
    if (filters.customFields && filters.customFields.length > 0) {
      for (const f of filters.customFields) {
        const key = sql.raw(`'${f.fieldId.replace(/'/g, "''")}'`)
        switch (f.op) {
          case "contains":
            // jsonb ->> key returns text; ILIKE matches case-insensitive.
            conditions.push(sql`${contacts.customFields} ->> ${key} ILIKE ${`%${f.value}%`}`)
            break
          case "eq":
            conditions.push(sql`${contacts.customFields} ->> ${key} = ${f.value}`)
            break
          case "in": {
            // multi_select stored as a JSON array; we OR each provided value
            // against array containment via ?| operator.
            const values = f.value.split(",").filter(Boolean)
            if (values.length > 0) {
              conditions.push(sql`(${contacts.customFields} -> ${key}) ?| ${values}::text[]`)
            }
            break
          }
          case "min":
            conditions.push(
              sql`(${contacts.customFields} ->> ${key})::numeric >= ${Number(f.value)}`,
            )
            break
          case "max":
            conditions.push(
              sql`(${contacts.customFields} ->> ${key})::numeric <= ${Number(f.value)}`,
            )
            break
          case "from":
            conditions.push(sql`(${contacts.customFields} ->> ${key})::date >= ${f.value}::date`)
            break
          case "to":
            conditions.push(
              sql`(${contacts.customFields} ->> ${key})::date < (${f.value}::date + INTERVAL '1 day')`,
            )
            break
        }
      }
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
