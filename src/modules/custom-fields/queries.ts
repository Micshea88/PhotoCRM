import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { withOrgContext } from "@/lib/org-context"
import { contacts } from "@/modules/contacts/schema"
import { companies } from "@/modules/companies/schema"
import { opportunities } from "@/modules/opportunities/schema"
import { projects } from "@/modules/projects/schema"
import { tasks } from "@/modules/tasks/schema"
import { customFieldDefinitions } from "./schema"

/**
 * Definitions for one record type, ordered by the explicit `order` column
 * then alphabetical by name. Soft-deleted rows excluded; archived rows
 * INCLUDED (host-form callers should filter `archivedAt` themselves when
 * rendering — the validators want archived defs included so existing
 * jsonb values on host rows still resolve).
 *
 * Typical callers:
 *   - host module `actions.ts` validating `custom_fields` payloads against
 *     the org's definitions
 *   - the /settings/custom-fields admin page (which renders archived
 *     rows under an "Archived" section)
 *
 * RLS scopes to the active org; no manual organizationId filter needed.
 */
export async function listFieldDefinitionsForRecordType(recordType: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.recordType, recordType),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .orderBy(customFieldDefinitions.order, customFieldDefinitions.name)
  })
}

/**
 * Active-only variant: archived definitions excluded. Use this for
 * host-form rendering (Push 4 A3) — archived defs should disappear
 * from the create/edit form while their existing jsonb values on
 * already-saved host rows stay intact.
 *
 * Action-layer validators must NOT use this — they need the archived
 * defs to (a) preserve existing archived values on update, and (b)
 * surface the "field has been archived" error when the payload
 * actively tries to write to one.
 */
export async function listActiveFieldDefinitionsForRecordType(recordType: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.recordType, recordType),
          isNull(customFieldDefinitions.deletedAt),
          isNull(customFieldDefinitions.archivedAt),
        ),
      )
      .orderBy(customFieldDefinitions.order, customFieldDefinitions.name)
  })
}

/**
 * Lookup by id. Used by host-module value validators ("does this jsonb key
 * correspond to a real definition, of the right type?"). Returns null for
 * not-found, including soft-deleted definitions — caller cannot distinguish
 * "never existed" from "deleted," which is the right behavior for value
 * resolution.
 */
export async function getFieldDefinition(id: string) {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select()
      .from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.id, id), isNull(customFieldDefinitions.deletedAt)))
      .limit(1)
    return row ?? null
  })
}

/**
 * For each definition id under one record type, how many live host rows
 * currently store a non-null value keyed by it. Used by the
 * /settings/custom-fields page to render the "Used by N records" hint.
 *
 * jsonb_each(...) unfolds the host row's custom_fields blob into (key,
 * value) pairs. Counting keys that aren't jsonb-null gives the
 * non-null-value usage requested by spec; missing keys naturally fall
 * out (they don't appear in the unfolding).
 */
const HOST_TABLES: Record<string, PgTable> = {
  contact: contacts,
  company: companies,
  opportunity: opportunities,
  project: projects,
  task: tasks,
}

export async function countDefinitionUsage(recordType: string): Promise<Map<string, number>> {
  const table = HOST_TABLES[recordType]
  if (!table) return new Map()
  return withOrgContext(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT entry.key AS def_id, COUNT(*)::int AS usage
      FROM ${table}, jsonb_each(COALESCE(custom_fields, '{}'::jsonb)) AS entry(key, value)
      WHERE deleted_at IS NULL
        AND entry.value != 'null'::jsonb
      GROUP BY entry.key
    `)
    const out = new Map<string, number>()
    for (const r of rows.rows as { def_id: string; usage: number }[]) {
      out.set(r.def_id, r.usage)
    }
    return out
  })
}
