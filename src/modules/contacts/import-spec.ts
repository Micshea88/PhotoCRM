/**
 * Push 2c — Contacts CSV import. Pure helpers shared by the wizard
 * (client) and the import server actions (server).
 *
 * ─── INLINE CSV PARSER ────────────────────────────────────────────────
 *
 * Push 2c was scoped to use papaparse but it never landed as a
 * dependency, so this file ships a minimal RFC-4180-style parser
 * instead. Handles:
 *   - comma-separated values
 *   - "double-quoted fields"
 *   - escaped quotes via "" inside quoted field
 *   - LF or CRLF line endings
 *   - leading UTF-8 BOM stripped
 *
 * Intentionally NOT handled (would graduate to papaparse if hit):
 *   - alternate delimiters (semicolons, tabs)
 *   - non-UTF-8 encodings
 *   - streaming mode
 *
 * Anything that doesn't parse with this minimal grammar gets surfaced
 * to the user as "Couldn't parse this CSV — re-export from your editor
 * as standard UTF-8 CSV and try again."
 */

import { z } from "zod"
import { CONTACT_TYPES, LIFECYCLE_STATUSES } from "./types"

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

export const CSV_MAX_ROWS = 10000

export function parseCsv(text: string): ParsedCsv {
  // Strip UTF-8 BOM if present.
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let current: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0
  const n = cleaned.length

  while (i < n) {
    const ch = cleaned.charAt(i)
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned.charAt(i + 1) === '"') {
          // Escaped quote — emit one quote, skip the pair.
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ",") {
      current.push(field)
      field = ""
      i += 1
      continue
    }
    if (ch === "\r") {
      // Normalize CRLF — peek and treat as one record terminator.
      if (cleaned.charAt(i + 1) === "\n") i += 1
      current.push(field)
      rows.push(current)
      current = []
      field = ""
      i += 1
      continue
    }
    if (ch === "\n") {
      current.push(field)
      rows.push(current)
      current = []
      field = ""
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  // Trailing field / row (CSVs commonly omit a final \n).
  if (field !== "" || current.length > 0) {
    current.push(field)
    rows.push(current)
  }

  const filtered = rows.filter((r) => !(r.length === 1 && r[0] === ""))
  const [headerRow, ...dataRows] = filtered
  return {
    headers: (headerRow ?? []).map((h) => h.trim()),
    rows: dataRows,
  }
}

// ─── Field mapping ─────────────────────────────────────────────────────

/**
 * The contact fields the import wizard can populate. The order matters
 * for the UI's field-picker dropdown. `null`-mapping means "ignore this
 * column" — surfaced as "— Don't import —" in the dropdown.
 */
export const IMPORTABLE_FIELDS = [
  "firstName",
  "lastName",
  "primaryEmail",
  "primaryPhone",
  "secondaryEmail",
  "secondaryPhone",
  "contactType",
  "lifecycleStatus",
  "leadSource",
  "sourceDetail",
  "tags",
  "notes",
  "website",
  "instagramHandle",
] as const
export type ImportableField = (typeof IMPORTABLE_FIELDS)[number]

export const FIELD_LABELS: Record<ImportableField, string> = {
  firstName: "First name",
  lastName: "Last name",
  primaryEmail: "Primary email",
  primaryPhone: "Primary phone",
  secondaryEmail: "Secondary email",
  secondaryPhone: "Secondary phone",
  contactType: "Contact type",
  lifecycleStatus: "Lifecycle status",
  leadSource: "Lead source",
  sourceDetail: "Source detail",
  tags: "Tags (comma-separated)",
  notes: "Notes",
  website: "Website",
  instagramHandle: "Instagram handle",
}

/**
 * Auto-mapping heuristics: header text → contact field. Run after
 * lower-casing + stripping non-alphanumeric chars. Empty / unmatched
 * headers stay at `null` so the user picks explicitly.
 */
const HEADER_HINTS: Record<string, ImportableField> = {
  firstname: "firstName",
  first: "firstName",
  givenname: "firstName",
  lastname: "lastName",
  last: "lastName",
  surname: "lastName",
  familyname: "lastName",
  email: "primaryEmail",
  emailaddress: "primaryEmail",
  primaryemail: "primaryEmail",
  secondaryemail: "secondaryEmail",
  email2: "secondaryEmail",
  phone: "primaryPhone",
  phonenumber: "primaryPhone",
  primaryphone: "primaryPhone",
  mobile: "primaryPhone",
  cell: "primaryPhone",
  secondaryphone: "secondaryPhone",
  phone2: "secondaryPhone",
  contacttype: "contactType",
  type: "contactType",
  lifecyclestatus: "lifecycleStatus",
  lifecycle: "lifecycleStatus",
  status: "lifecycleStatus",
  leadsource: "leadSource",
  source: "leadSource",
  sourcedetail: "sourceDetail",
  tags: "tags",
  notes: "notes",
  note: "notes",
  website: "website",
  url: "website",
  instagram: "instagramHandle",
  instagramhandle: "instagramHandle",
  ig: "instagramHandle",
}

export function autoMapHeaders(headers: string[]): (ImportableField | null)[] {
  return headers.map((h) => {
    const key = h.toLowerCase().replace(/[^a-z0-9]/g, "")
    return HEADER_HINTS[key] ?? null
  })
}

// ─── Row validation ────────────────────────────────────────────────────

const emailSchema = z.union([z.email(), z.literal("")])
const urlSchema = z.union([z.url(), z.literal("")])

/**
 * Turn a raw CSV row + field mapping into a CleanRow keyed by contact
 * field. Validation errors are surfaced inline (one per row) so the
 * preview can show "what would actually import" without dropping the
 * whole row from the dataset.
 */
export interface CleanRow {
  rowIndex: number // 1-based for user-facing error reporting
  values: Partial<Record<ImportableField, string>>
  errors: string[]
}

export function buildCleanRow(
  rowIndex: number,
  rawRow: string[],
  mapping: (ImportableField | null)[],
): CleanRow {
  const values: Partial<Record<ImportableField, string>> = {}
  const errors: string[] = []
  for (let i = 0; i < mapping.length; i++) {
    const field = mapping[i]
    if (!field) continue
    const raw = (rawRow[i] ?? "").trim()
    if (!raw) continue
    values[field] = raw
  }

  // First + last name are the only hard-required fields. A row without
  // either is unimportable (Contact requires firstName + lastName per
  // types.ts).
  if (!values.firstName) errors.push("firstName is required")
  if (!values.lastName) errors.push("lastName is required")

  if (values.primaryEmail) {
    const r = emailSchema.safeParse(values.primaryEmail)
    if (!r.success) errors.push("primaryEmail is not a valid email")
  }
  if (values.secondaryEmail) {
    const r = emailSchema.safeParse(values.secondaryEmail)
    if (!r.success) errors.push("secondaryEmail is not a valid email")
  }
  if (values.website) {
    const r = urlSchema.safeParse(values.website)
    if (!r.success) errors.push("website is not a valid URL")
  }
  if (values.contactType && !CONTACT_TYPES.includes(values.contactType as never)) {
    errors.push(`contactType must be one of: ${CONTACT_TYPES.join(", ")}`)
  }
  if (values.lifecycleStatus && !LIFECYCLE_STATUSES.includes(values.lifecycleStatus as never)) {
    errors.push(`lifecycleStatus must be one of: ${LIFECYCLE_STATUSES.join(", ")}`)
  }

  return { rowIndex, values, errors }
}

// ─── Phone normalization (for dedupe matching) ─────────────────────────

/**
 * Reduce a phone string to digits-only. Matches the same normalization
 * the contacts query layer applies for phone search. Empty → null.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, "")
  return digits.length > 0 ? digits : null
}

// ─── Errors-as-CSV helper ──────────────────────────────────────────────

/**
 * Build a downloadable CSV blob containing the rows that errored
 * during import. Includes the row index + error + original raw values
 * so the user can fix and re-import.
 */
export function buildErrorsCsv(
  headers: string[],
  errors: { rowIndex: number; error: string; raw: string[] }[],
): string {
  const headerLine = ["row", "error", ...headers].map(csvEscape).join(",")
  const lines = errors.map((e) => [String(e.rowIndex), e.error, ...e.raw].map(csvEscape).join(","))
  return [headerLine, ...lines].join("\n")
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
