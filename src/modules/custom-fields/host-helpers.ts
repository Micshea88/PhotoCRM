import "server-only"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { ArchivedFieldUpdateError, validateCustomFieldsPayloadWithArchive } from "./validators"
import { listFieldDefinitionsForRecordTypeWithDb } from "./queries"
import { detectCustomFieldChanges, type CustomFieldChange } from "./changes"
import type { CustomFieldDefinition } from "./schema"
import { ActionError } from "@/lib/safe-action"
import { log } from "@/lib/log"

/**
 * Push 4 (A3 hotfix) — shared helpers used by every host-entity action
 * layer (contacts, companies, opportunities, projects) to make
 * custom_fields writes consistent and audit-log-aware.
 *
 * Architecture note (the hotfix): callers MUST pass `ctx.db` (the
 * action's own transaction). orgAction sets `app.current_org` as a
 * transaction-local pg setting but does NOT populate
 * AsyncLocalStorage, so the ALS-based `withOrgContext` query path
 * throws "no org context in scope" when invoked from inside an
 * action body. Threading the tx handle through here mirrors the
 * `lookupExtendedMemberRole(tx, userId)` pattern in
 * `src/modules/rbac/queries.ts`.
 *
 * Two responsibilities:
 *
 *   1. CREATE-side validation: drop archived-keyed entries silently,
 *      validate active entries against their typed schemas, throw on
 *      malformed values.
 *
 *   2. UPDATE-side merge: load existing jsonb from the row, validate
 *      incoming payload against active defs, refuse to write to
 *      archived keys (friendly error), preserve archived-keyed
 *      existing values by merging them into the result, and surface
 *      the (before, after) diff for the audit log.
 *
 * Centralising this here means every entity gets the same archive
 * semantic — when companies / opportunities ship UI in later pushes,
 * the form layer doesn't need to know anything about the archive
 * lifecycle.
 */

type DbHandle = NodePgDatabase<typeof schema>

interface DefSplit {
  all: CustomFieldDefinition[]
  active: Map<string, CustomFieldDefinition>
  archived: Map<string, CustomFieldDefinition>
}

async function loadDefSplit(db: DbHandle, recordType: string): Promise<DefSplit> {
  const all = await listFieldDefinitionsForRecordTypeWithDb(db, recordType)
  const active = new Map<string, CustomFieldDefinition>()
  const archived = new Map<string, CustomFieldDefinition>()
  for (const d of all) {
    if (d.archivedAt) {
      archived.set(d.id, d)
    } else {
      active.set(d.id, d)
    }
  }
  return { all, active, archived }
}

/**
 * Used by every host-entity CREATE action. Returns the validated
 * jsonb payload (or null) and the list of defs.
 *
 * `db` MUST be the action's `ctx.db` transaction — it carries the
 * pg-level `app.current_org` setting that RLS reads.
 */
export async function prepareCustomFieldsForCreate(
  db: DbHandle,
  recordType: string,
  payload: Record<string, unknown> | null | undefined,
): Promise<{ value: Record<string, unknown> | null; definitions: CustomFieldDefinition[] }> {
  if (!payload || Object.keys(payload).length === 0) {
    return { value: null, definitions: [] }
  }
  const split = await loadDefSplit(db, recordType)
  try {
    const validated = validateCustomFieldsPayloadWithArchive(
      split.active,
      split.archived,
      payload,
      "create",
      {
        onUnknownKey: (defId) => {
          log.warn(
            { defId, recordType },
            "custom_fields: dropped value for unknown definition id (likely soft-deleted)",
          )
        },
      },
    )
    return {
      value: Object.keys(validated).length === 0 ? null : validated,
      definitions: split.all,
    }
  } catch (err) {
    throw new ActionError(
      "VALIDATION",
      err instanceof Error ? err.message : "Invalid custom field value",
    )
  }
}

/**
 * Used by every host-entity UPDATE action.
 *
 * - `db`: the action's `ctx.db` transaction (carries pg session settings).
 * - `existing`: the current jsonb on the row (typically loaded as part
 *   of the SELECT-then-UPDATE flow, or via a separate fetch).
 * - `payload`: the incoming customFields from parsedInput.
 *
 * If the caller didn't include customFields in the update payload at
 * all, the host action should skip this helper entirely (preserves
 * existing semantics: "no scrubbing"). This helper is for the case
 * where the payload IS present.
 *
 * Returns the merged jsonb to write + the changes for audit metadata.
 */
export async function prepareCustomFieldsForUpdate(
  db: DbHandle,
  recordType: string,
  existing: Record<string, unknown> | null,
  payload: Record<string, unknown> | null | undefined,
): Promise<{
  value: Record<string, unknown> | null
  changes: CustomFieldChange[]
}> {
  const split = await loadDefSplit(db, recordType)

  // Validate the payload's active entries; throws on archived-key
  // collision or malformed values.
  let validated: Record<string, unknown>
  try {
    validated = validateCustomFieldsPayloadWithArchive(
      split.active,
      split.archived,
      payload ?? {},
      "update",
      {
        onUnknownKey: (defId) => {
          log.warn(
            { defId, recordType },
            "custom_fields: dropped value for unknown definition id (likely soft-deleted)",
          )
        },
      },
    )
  } catch (err) {
    if (err instanceof ArchivedFieldUpdateError) {
      throw new ActionError("VALIDATION", err.message)
    }
    throw new ActionError(
      "VALIDATION",
      err instanceof Error ? err.message : "Invalid custom field value",
    )
  }

  // Preserve archived-keyed values from `existing`. The payload was
  // validated against active-only, so it can't legally carry archived
  // keys; we merge from `existing` to keep them.
  const preservedArchived: Record<string, unknown> = {}
  const existingMap = existing ?? {}
  for (const archivedId of split.archived.keys()) {
    if (archivedId in existingMap) {
      preservedArchived[archivedId] = existingMap[archivedId]
    }
  }

  const merged: Record<string, unknown> = { ...validated, ...preservedArchived }
  const finalValue = Object.keys(merged).length === 0 ? null : merged

  const changes = detectCustomFieldChanges(existing, finalValue, split.all)

  return { value: finalValue, changes }
}
