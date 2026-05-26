import { contactLabel } from "../display"
import { formatPhoneDisplay } from "@/lib/format/phone"
import {
  buildCustomFieldColumnId,
  customFieldColumnLabel,
  formatCustomFieldCell,
  readCustomFieldValue,
  type ListCustomFieldDef,
} from "@/modules/custom-fields/ui/column-helpers"

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
  // Push 2c.6 — additional DB-backed fields surfaced through Edit
  // columns. All default visible: false (resolveContactColumns appends
  // hidden-by-default at the end), so existing All Contacts views
  // keep their shape until a user opts these on.
  secondaryEmail: string | null
  secondaryPhone: string | null
  mailingCity: string | null
  mailingState: string | null
  mailingZip: string | null
  dob: string | null
  anniversaryDate: string | null
  instagramHandle: string | null
  facebookUrl: string | null
  website: string | null
  leadSource: string | null
  sourceDetail: string | null
  ownerName: string | null
  updatedAt: string | null
  notes: string | null
  /** Push 4 (A4) — raw custom_fields jsonb. The column renderer reads
   * the per-definition value from here. Nullable because most
   * contacts won't have any. */
  customFields: Record<string, unknown> | null
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
  // ── Push 2c.6 expansion ────────────────────────────────────────
  // Each new column id is stable + immutable once shipped. Defaults
  // to visible: false via the resolveContactColumns padding step.
  // Renders are null-safe — every contact field below is nullable
  // in the DB schema.
  secondaryEmail: {
    id: "secondaryEmail",
    label: "Secondary email",
    defaultWidth: 240,
    render: (row) => row.secondaryEmail ?? "",
    measureText: (row) => row.secondaryEmail ?? "",
  },
  secondaryPhone: {
    id: "secondaryPhone",
    label: "Secondary phone",
    defaultWidth: 160,
    render: (row) => formatPhoneDisplay(row.secondaryPhone),
    measureText: (row) => formatPhoneDisplay(row.secondaryPhone),
  },
  mailingCity: {
    id: "mailingCity",
    label: "Mailing city",
    defaultWidth: 160,
    render: (row) => row.mailingCity ?? "",
    measureText: (row) => row.mailingCity ?? "",
  },
  mailingState: {
    id: "mailingState",
    label: "Mailing state",
    defaultWidth: 120,
    render: (row) => row.mailingState ?? "",
    measureText: (row) => row.mailingState ?? "",
  },
  mailingZip: {
    id: "mailingZip",
    label: "Mailing zip",
    defaultWidth: 120,
    render: (row) => row.mailingZip ?? "",
    measureText: (row) => row.mailingZip ?? "",
  },
  dob: {
    id: "dob",
    label: "Birthday",
    defaultWidth: 140,
    // dob is a Drizzle `date` column → string in YYYY-MM-DD form
    // (or null). Show as-is for consistency with createdAt's
    // ISO-slice rendering.
    render: (row) => row.dob ?? "",
    measureText: (row) => row.dob ?? "",
  },
  anniversaryDate: {
    id: "anniversaryDate",
    label: "Anniversary",
    defaultWidth: 140,
    render: (row) => row.anniversaryDate ?? "",
    measureText: (row) => row.anniversaryDate ?? "",
  },
  instagramHandle: {
    id: "instagramHandle",
    label: "Instagram",
    defaultWidth: 160,
    render: (row) => row.instagramHandle ?? "",
    measureText: (row) => row.instagramHandle ?? "",
  },
  facebookUrl: {
    id: "facebookUrl",
    label: "Facebook",
    defaultWidth: 220,
    render: (row) => row.facebookUrl ?? "",
    measureText: (row) => row.facebookUrl ?? "",
  },
  website: {
    id: "website",
    label: "Website",
    defaultWidth: 220,
    render: (row) => row.website ?? "",
    measureText: (row) => row.website ?? "",
  },
  leadSource: {
    id: "leadSource",
    label: "Lead source",
    defaultWidth: 160,
    render: (row) => row.leadSource ?? "",
    measureText: (row) => row.leadSource ?? "",
  },
  sourceDetail: {
    id: "sourceDetail",
    label: "Source detail",
    defaultWidth: 180,
    render: (row) => row.sourceDetail ?? "",
    measureText: (row) => row.sourceDetail ?? "",
  },
  ownerName: {
    id: "ownerName",
    label: "Owner",
    defaultWidth: 180,
    // The owner_user_id FK is resolved server-side into a display
    // name (via the orgMembers lookup) — see contacts/page.tsx
    // row mapping. Falls back to "" when the contact has no owner
    // or the linked user has been deleted.
    render: (row) => row.ownerName ?? "",
    measureText: (row) => row.ownerName ?? "",
  },
  updatedAt: {
    id: "updatedAt",
    label: "Date updated",
    defaultWidth: 140,
    render: (row) => (row.updatedAt ? row.updatedAt.slice(0, 10) : ""),
    measureText: (row) => (row.updatedAt ? row.updatedAt.slice(0, 10) : ""),
  },
  notes: {
    id: "notes",
    label: "Notes",
    defaultWidth: 280,
    // Notes can be long + multiline; the table cell already clips
    // overflow with CSS truncation. Collapse newlines so the
    // measureText canvas + visible cell agree on what they're
    // seeing.
    render: (row) => (row.notes ? row.notes.replace(/\s+/g, " ").trim() : ""),
    measureText: (row) => (row.notes ? row.notes.replace(/\s+/g, " ").trim() : ""),
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
 * Push 4 (A4) — build a per-custom-field column def. Used to extend
 * the column registry dynamically at render time. The id namespacing
 * (`cf:<fieldId>`) is centralised in
 * `@/modules/custom-fields/ui/column-helpers`.
 */
function buildCustomFieldColumnDef(def: ListCustomFieldDef): ContactColumnDef {
  const id = buildCustomFieldColumnId(def.id)
  const render = (row: ContactRow) =>
    formatCustomFieldCell(def, readCustomFieldValue(row.customFields, def.id))
  return {
    id,
    label: customFieldColumnLabel(def),
    defaultWidth: 180,
    render,
    measureText: render,
  }
}

/**
 * Compose the intrinsic CONTACT_COLUMN_REGISTRY with per-org custom
 * field definitions. Used by `resolveContactColumns` callers (Edit
 * columns drawer, table render). When no custom fields are defined
 * yet, the merged registry equals the intrinsic one.
 */
export function buildContactColumnRegistry(
  customFieldDefs: ListCustomFieldDef[],
): Record<string, ContactColumnDef> {
  const merged: Record<string, ContactColumnDef> = { ...CONTACT_COLUMN_REGISTRY }
  for (const def of customFieldDefs) {
    const cfCol = buildCustomFieldColumnDef(def)
    merged[cfCol.id] = cfCol
  }
  return merged
}

/**
 * Resolve a stored column_config (or empty/missing) into the actual
 * ordered + visible columns to render. Three responsibilities:
 *   1. Drop ids that no longer exist in the registry (forward-compat).
 *   2. Append registry ids missing from the saved config as
 *      hidden-by-default, so the Edit columns drawer can offer them.
 *   3. Push 4 (A4) — merge per-org custom-field columns into the
 *      registry before resolving. When `customFieldDefs` is omitted,
 *      behavior matches pre-A4 (intrinsic-only).
 */
export function resolveContactColumns(
  saved: ColumnConfigItem[],
  customFieldDefs: ListCustomFieldDef[] = [],
): {
  visible: ContactColumnDef[]
  all: (ColumnConfigItem & { def: ContactColumnDef })[]
} {
  const registry = buildContactColumnRegistry(customFieldDefs)
  const allIds = Object.keys(registry)
  const inRegistry = saved.filter((c) => registry[c.id])
  const knownIds = new Set(inRegistry.map((c) => c.id))
  const missing = allIds.filter((id) => !knownIds.has(id))
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
    const def = registry[c.id]
    return def ? [{ ...c, def }] : []
  })
  const visible = all.filter((c) => c.visible).map((c) => c.def)
  return { visible, all }
}
