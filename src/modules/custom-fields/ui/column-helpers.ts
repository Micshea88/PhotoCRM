import type { CustomFieldDefinition } from "../schema"
import type { FieldType } from "../types"

/**
 * Narrow def shape sufficient for list-view column + filter consumers
 * (drawers, table renderers). Source-of-truth Drizzle type is wider
 * and includes audit / FK columns the UI doesn't need. Page loaders
 * project DB rows down to this shape so client components don't pull
 * in the full Drizzle row (and the `archivedAt` timestamp passes
 * across the server→client boundary as an ISO string).
 *
 * Structurally compatible with `CustomFieldDefinition` for the
 * non-Date `archivedAt` case via the union.
 */
export interface ListCustomFieldDef {
  id: string
  name: string
  fieldType: string
  options: { choices?: { value: string; label: string }[] } | null
  archivedAt: string | Date | null
}

/**
 * Push 4 (A4) — entity-agnostic helpers for surfacing custom-field
 * definitions as toggleable columns in any list view's
 * column_config jsonb.
 *
 * Convention: a column whose id starts with `cf:` denotes a custom
 * field. The id payload is the `custom_field_definitions.id` cuid2.
 * Same convention contacts-shell.tsx's URL+filter serializer uses for
 * the saved-view filter shape (`field: "customField.<fieldId>"`), so
 * column ids and filter fields are decodable in isolation.
 *
 * When the contacts list page ships custom-field columns (this push)
 * AND when the future companies / opportunities / projects list pages
 * ship them (P4.x), they all consume these helpers — the column-id
 * encoding stays identical across entities so saved-view jsonb is
 * portable.
 */

const CUSTOM_PREFIX = "cf:"

export function buildCustomFieldColumnId(fieldId: string): string {
  return `${CUSTOM_PREFIX}${fieldId}`
}

export function parseCustomFieldColumnId(columnId: string): string | null {
  if (!columnId.startsWith(CUSTOM_PREFIX)) return null
  const id = columnId.slice(CUSTOM_PREFIX.length)
  return id.length > 0 ? id : null
}

export function isCustomFieldColumnId(columnId: string): boolean {
  return parseCustomFieldColumnId(columnId) !== null
}

/**
 * Render a custom-field value (extracted from the host row's
 * `custom_fields` jsonb) for display in a list cell. Lossy — meant
 * for narrow table cells. The per-type formatting matches the
 * read-only renderer (A3) where it can, but skips link wrapping
 * since list cells are text.
 *
 * Unknown / formula values render to empty string; the cell label
 * already shows the user the column is computed-or-not via the
 * column header.
 */
export function formatCustomFieldCell(
  definition: ListCustomFieldDef | CustomFieldDefinition,
  value: unknown,
): string {
  if (value === null || value === undefined || value === "") return ""
  const fieldType = definition.fieldType as FieldType
  switch (fieldType) {
    case "text":
    case "multiline":
    case "email":
    case "phone":
    case "url":
    case "date":
    case "user_ref":
    case "contact_ref":
    case "event_ref":
      return typeof value === "string" ? value : ""
    case "number":
      return typeof value === "number" ? String(value) : ""
    case "currency":
      if (typeof value !== "number") return ""
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
    case "datetime":
      if (typeof value !== "string") return ""
      try {
        return new Date(value).toLocaleString()
      } catch {
        return value
      }
    case "checkbox":
      return value === true ? "Yes" : value === false ? "No" : ""
    case "single_select":
    case "radio": {
      if (typeof value !== "string") return ""
      const choices =
        (definition.options as { choices?: { value: string; label: string }[] } | null)?.choices ??
        []
      const m = choices.find((c) => c.value === value)
      return m?.label ?? value
    }
    case "multi_select": {
      if (!Array.isArray(value)) return ""
      const choices =
        (definition.options as { choices?: { value: string; label: string }[] } | null)?.choices ??
        []
      return (value as string[])
        .map((v) => choices.find((c) => c.value === v)?.label ?? v)
        .join(", ")
    }
    case "file":
    case "image":
      // List cells don't link; show the filename portion of the URL
      // if extractable, otherwise the URL itself.
      if (typeof value !== "string") return ""
      try {
        const u = new URL(value)
        const seg = u.pathname.split("/").pop()
        return seg ?? value
      } catch {
        return value
      }
    case "formula":
      if (typeof value === "string" || typeof value === "number") return String(value)
      if (typeof value === "boolean") return value ? "Yes" : "No"
      return ""
    default: {
      const exhaustive: never = fieldType
      return String(exhaustive)
    }
  }
}

/**
 * Compose a custom-field column label. When the definition is archived
 * we append "(archived)" so saved views that reference now-archived
 * fields render with a visible reason to remove the column.
 */
export function customFieldColumnLabel(
  definition: ListCustomFieldDef | CustomFieldDefinition,
): string {
  return definition.archivedAt ? `${definition.name} (archived)` : definition.name
}

/**
 * Given a host row's custom_fields jsonb (typed loose) + a definition
 * id, return the value or null. Defensive — handles missing payload
 * and missing key without throwing.
 */
export function readCustomFieldValue(
  jsonb: Record<string, unknown> | null | undefined,
  fieldId: string,
): unknown {
  if (!jsonb) return null
  return jsonb[fieldId] ?? null
}
