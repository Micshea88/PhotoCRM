import { contactLabel } from "../display"
import { formatPhoneDisplay } from "@/lib/format/phone"

/**
 * Column registry for the contacts list. Each entry maps a stable
 * `id` (the same key used in saved_views.column_config) to a display
 * label and a renderer function. The Edit columns drawer + table
 * read this registry; saved views persist the ordered list of ids
 * with visibility + width.
 *
 * Adding a new column = add an entry here, default it visible in
 * `DEFAULT_CONTACT_COLUMNS`, and the saved-view migration on save
 * picks it up. Removing a column = leave it in the registry as
 * hidden-by-default (avoid breaking saved views whose column_config
 * references the removed id) until a migration sweeps it.
 */

export interface ContactRow {
  id: string
  firstName: string
  lastName: string
  primaryEmail: string | null
  primaryPhone: string | null
  contactType: string | null
  lifecycleStatus: string | null
  tags: string[] | null
  companyName: string | null
  createdAt: string
}

export interface ContactColumnDef {
  id: string
  label: string
  /** Default width in pixels (overridable per saved view). null = grow */
  defaultWidth: number | null
  render: (row: ContactRow) => string
}

export const CONTACT_COLUMN_REGISTRY: Record<string, ContactColumnDef> = {
  displayLabel: {
    id: "displayLabel",
    label: "Name",
    defaultWidth: null,
    render: (row) =>
      contactLabel(
        {
          firstName: row.firstName,
          lastName: row.lastName,
          primaryEmail: row.primaryEmail,
        },
        row.companyName,
      ),
  },
  primaryEmail: {
    id: "primaryEmail",
    label: "Email",
    defaultWidth: null,
    render: (row) => row.primaryEmail ?? "",
  },
  primaryPhone: {
    id: "primaryPhone",
    label: "Phone",
    defaultWidth: 160,
    render: (row) => formatPhoneDisplay(row.primaryPhone),
  },
  contactType: {
    id: "contactType",
    label: "Type",
    defaultWidth: 140,
    render: (row) => row.contactType ?? "",
  },
  lifecycleStatus: {
    id: "lifecycleStatus",
    label: "Status",
    defaultWidth: 140,
    render: (row) => row.lifecycleStatus ?? "",
  },
  tags: {
    id: "tags",
    label: "Tags",
    defaultWidth: null,
    render: (row) => (row.tags ?? []).join(", "),
  },
  companyName: {
    id: "companyName",
    label: "Company",
    defaultWidth: null,
    render: (row) => row.companyName ?? "",
  },
  createdAt: {
    id: "createdAt",
    label: "Created",
    defaultWidth: 140,
    render: (row) => row.createdAt.slice(0, 10),
  },
}

export const ALL_CONTACT_COLUMN_IDS = Object.keys(CONTACT_COLUMN_REGISTRY)

/** Default ordered+visible column set for a fresh All Contacts view. */
export const DEFAULT_CONTACT_COLUMNS = [
  "displayLabel",
  "primaryEmail",
  "primaryPhone",
  "contactType",
  "lifecycleStatus",
  "tags",
] as const

export interface ColumnConfigItem {
  id: string
  visible: boolean
  order: number
  width: number | null
}

/**
 * Resolve a stored column_config (or empty/missing) into the actual
 * ordered + visible columns to render. Two responsibilities:
 *   1. Drop ids that no longer exist in the registry (forward-compat).
 *   2. Append registry ids missing from the saved config as
 *      hidden-by-default, so the Edit columns drawer can offer them.
 */
export function resolveContactColumns(saved: ColumnConfigItem[]): {
  visible: ContactColumnDef[]
  all: (ColumnConfigItem & { def: ContactColumnDef })[]
} {
  const inRegistry = saved.filter((c) => CONTACT_COLUMN_REGISTRY[c.id])
  const knownIds = new Set(inRegistry.map((c) => c.id))
  const missing = ALL_CONTACT_COLUMN_IDS.filter((id) => !knownIds.has(id))
  // Hidden-by-default fallback. The first time a user opens Edit
  // columns these will show up unchecked at the bottom.
  const maxOrder = inRegistry.reduce((m, c) => Math.max(m, c.order), -1)
  const padded = [
    ...inRegistry,
    ...missing.map((id, i) => ({
      id,
      visible: false,
      order: maxOrder + 1 + i,
      width: null as number | null,
    })),
  ].sort((a, b) => a.order - b.order)

  const all = padded.flatMap((c) => {
    const def = CONTACT_COLUMN_REGISTRY[c.id]
    return def ? [{ ...c, def }] : []
  })
  const visible = all.filter((c) => c.visible).map((c) => c.def)
  return { visible, all }
}
