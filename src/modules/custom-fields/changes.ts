import type { CustomFieldDefinition } from "./schema"

/**
 * Push 4 (A3) — diff a before/after `custom_fields jsonb` pair against
 * the org's definitions for the host's record_type and return per-
 * definition change records suitable for the audit log.
 *
 * Captures four scenarios:
 *   - set → set  (value modified)
 *   - set → null (cleared)
 *   - null → set (added)
 *   - no-op       (skipped)
 *
 * Equality is structural via JSON.stringify — good enough for the V1
 * field types (text, numbers, dates as ISO strings, select arrays,
 * file URLs, reference cuids). Object-identity wouldn't be reliable
 * since the action layer reconstructs the merged object on every
 * write.
 *
 * Definitions that aren't present in the map are skipped — the diff
 * is scoped to the defs the caller knows about. A change on an
 * orphaned key (definition deleted between writes) doesn't surface
 * here; that's a logging concern in the validator, not an audit
 * concern.
 */

export interface CustomFieldChange {
  fieldId: string
  fieldName: string
  fieldType: string
  before: unknown
  after: unknown
}

function normalizeJsonbAbsent(v: unknown): unknown {
  return v === undefined ? null : v
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

export function detectCustomFieldChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  definitions: CustomFieldDefinition[],
): CustomFieldChange[] {
  const beforeMap = before ?? {}
  const afterMap = after ?? {}
  const out: CustomFieldChange[] = []
  for (const def of definitions) {
    const b = normalizeJsonbAbsent(beforeMap[def.id])
    const a = normalizeJsonbAbsent(afterMap[def.id])
    if (isEqual(a, b)) continue
    out.push({
      fieldId: def.id,
      fieldName: def.name,
      fieldType: def.fieldType,
      before: b,
      after: a,
    })
  }
  return out
}
