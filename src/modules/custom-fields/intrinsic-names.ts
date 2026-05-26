import { getTableColumns, type Column } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { contacts } from "@/modules/contacts/schema"
import { companies } from "@/modules/companies/schema"
import { opportunities } from "@/modules/opportunities/schema"
import { projects } from "@/modules/projects/schema"
import { tasks } from "@/modules/tasks/schema"
import { ActionError } from "@/lib/safe-action"

/**
 * Push 4 (A2) — intrinsic-field collision guard for the
 * /settings/custom-fields editor.
 *
 * "Intrinsic" = a column that already exists on the host table. Letting a
 * user create a custom field with the same name as a built-in column makes
 * a confusing UI (two "Email" fields, one stored in the column, one in the
 * jsonb blob). We surface a CONFLICT and direct them to the built-in.
 *
 * Strategy:
 *   1. Introspect the entity's Drizzle table via getTableColumns().
 *   2. Drop infrastructure columns (id, organization_id, custom_fields,
 *      created/updated/deleted/archived audit columns) and any FK column
 *      whose db name ends in `_id` — those aren't user-facing.
 *   3. Normalize each remaining db name (snake_case → lower-no-spaces).
 *   4. Add curated aliases that map common UX wording to the canonical
 *      column (e.g., "Email" → primary_email, "Domain" → website). The
 *      tests in custom-fields-collision.test.ts pin the alias contract.
 *   5. Normalize the candidate name the same way and check membership.
 *
 * Matching is case-insensitive and ignores spaces/underscores so
 * "Lead Source", "lead_source", "LEADSOURCE" all collide with the
 * `lead_source` column.
 */

const RECORD_TYPES = ["contact", "company", "opportunity", "project", "task"] as const
export type CollisionRecordType = (typeof RECORD_TYPES)[number]

const TABLE_FOR_RECORD_TYPE: Record<CollisionRecordType, PgTable> = {
  contact: contacts,
  company: companies,
  opportunity: opportunities,
  project: projects,
  task: tasks,
}

const ENTITY_DISPLAY: Record<CollisionRecordType, string> = {
  contact: "Contact",
  company: "Company",
  opportunity: "Opportunity",
  project: "Project",
  task: "Task",
}

const EXCLUDED_COLUMN_NAMES = new Set([
  "id",
  "organization_id",
  "custom_fields",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "deleted_at",
  "deleted_by",
  "archived_at",
  "archived_by",
  "merged_record_ids",
])

const ENTITY_ALIASES: Record<CollisionRecordType, readonly string[]> = {
  contact: ["email", "phone", "name", "owner"],
  company: ["domain", "phone", "owner"],
  opportunity: ["stage", "amount", "value", "probability", "owner", "close_date"],
  project: ["start_date", "end_date", "owner", "venue", "date"],
  task: ["due_date", "owner", "assignee"],
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, "")
}

function isFkColumnName(dbName: string): boolean {
  return dbName.endsWith("_id")
}

export function getIntrinsicNamesForRecordType(recordType: CollisionRecordType): Set<string> {
  const table = TABLE_FOR_RECORD_TYPE[recordType]
  const cols = getTableColumns(table) as Record<string, Column>
  const names = new Set<string>()
  for (const col of Object.values(cols)) {
    const dbName = col.name
    if (EXCLUDED_COLUMN_NAMES.has(dbName)) continue
    if (isFkColumnName(dbName)) continue
    names.add(normalize(dbName))
    if (dbName.startsWith("primary_") || dbName.startsWith("secondary_")) {
      names.add(normalize(dbName.replace(/^(primary|secondary)_/, "")))
    }
  }
  for (const alias of ENTITY_ALIASES[recordType]) {
    names.add(normalize(alias))
  }
  return names
}

export function assertNoIntrinsicNameCollision(recordType: string, candidateName: string): void {
  if (!(RECORD_TYPES as readonly string[]).includes(recordType)) return
  const rt = recordType as CollisionRecordType
  const intrinsics = getIntrinsicNamesForRecordType(rt)
  if (intrinsics.has(normalize(candidateName))) {
    throw new ActionError(
      "CONFLICT",
      `A field named "${candidateName}" already exists as a built-in field on ${ENTITY_DISPLAY[rt]}. Use the built-in field instead.`,
    )
  }
}
