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
  /**
   * Push 2c.1.1 — exact visible string for auto-fit width measurement.
   * Defaults to mirroring `render`. Override when the rendered text and
   * the measured text need to diverge (e.g., a future render returns
   * JSX with icons; measureText returns just the words).
   */
  measureText: (row: ContactRow) => string
}

// Push 2c.1.1 — each entry's measureText returns the EXACT visible
// rendered string so canvas measureText (used by the divider-dblclick
// auto-fit) sees the same text the user sees. For columns where the
// render function already returns a plain string, measureText is the
// same function. Listed explicitly per column so a future render change
// (e.g., adding an icon prefix) won't silently break auto-fit accuracy.
function displayLabelText(row: ContactRow): string {
  return contactLabel(
    { firstName: row.firstName, lastName: row.lastName, primaryEmail: row.primaryEmail },
    row.companyName,
  )
}

export const CONTACT_COLUMN_REGISTRY: Record<string, ContactColumnDef> = {
  displayLabel: {
    id: "displayLabel",
    label: "Name",
    // Push 2c.2.2 — explicit defaults on every column so table-layout:
    // fixed has a width to honor in the header row. Columns with null
    // defaults inside table-fixed get equal shares of remaining table
    // width, which prevented the table from ever overflowing the
    // viewport and made the horizontal scrollbar dormant.
    defaultWidth: 280,
    render: displayLabelText,
    measureText: displayLabelText,
  },
  // Push 2c.1 — first name and last name as their own togglable columns.
  // Default-hidden (resolveContactColumns adds missing registry ids as
  // visible=false at the end), so existing All Contacts views don't
  // change shape. Users can show one or both via Edit columns.
  firstName: {
    id: "firstName",
    label: "First name",
    defaultWidth: 140,
    render: (row) => row.firstName,
    measureText: (row) => row.firstName,
  },
  lastName: {
    id: "lastName",
    label: "Last name",
    defaultWidth: 140,
    render: (row) => row.lastName,
    measureText: (row) => row.lastName,
  },
  primaryEmail: {
    id: "primaryEmail",
    label: "Email",
    defaultWidth: 240,
    render: (row) => row.primaryEmail ?? "",
    measureText: (row) => row.primaryEmail ?? "",
  },
  primaryPhone: {
    id: "primaryPhone",
    label: "Phone",
    defaultWidth: 160,
    render: (row) => formatPhoneDisplay(row.primaryPhone),
    measureText: (row) => formatPhoneDisplay(row.primaryPhone),
  },
  contactType: {
    id: "contactType",
    label: "Type",
    defaultWidth: 140,
    render: (row) => row.contactType ?? "",
    measureText: (row) => row.contactType ?? "",
  },
  lifecycleStatus: {
    id: "lifecycleStatus",
    label: "Status",
    defaultWidth: 140,
    render: (row) => row.lifecycleStatus ?? "",
    measureText: (row) => row.lifecycleStatus ?? "",
  },
  tags: {
    id: "tags",
    label: "Tags",
    defaultWidth: 200,
    render: (row) => (row.tags ?? []).join(", "),
    measureText: (row) => (row.tags ?? []).join(", "),
  },
  companyName: {
    id: "companyName",
    label: "Company",
    defaultWidth: 220,
    render: (row) => row.companyName ?? "",
    measureText: (row) => row.companyName ?? "",
  },
  createdAt: {
    id: "createdAt",
    label: "Created",
    defaultWidth: 140,
    render: (row) => row.createdAt.slice(0, 10),
    measureText: (row) => row.createdAt.slice(0, 10),
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
