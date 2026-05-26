/**
 * Push 2c / 2c.1 — Contacts CSV import. Pure helpers shared by the
 * wizard (client) and the import server actions (server).
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
 * Push 2c.1 — the contact fields the import wizard can populate. Order
 * matters for the UI's field-picker dropdown.
 *
 * `fullName` is a SPECIAL pseudo-field: it has no DB column. Mapping a
 * column to fullName triggers an auto-split in buildCleanRow that
 * populates firstName + lastName on the first space. Explicit
 * firstName / lastName mappings always win over the split.
 *
 * `ownerUserId` is also semi-special: the wizard accepts an email here
 * and resolves it to a user_id at import time (see runContactsImport).
 *
 * Mailing fields are persisted into the `mailing_address` jsonb column
 * (street1 / city / state / zip per types.ts:mailingAddressSchema).
 * `mailingCountry` and `jobTitle` from the broader CRM-import vocab
 * are intentionally NOT in this list because the V1 schema is US-only
 * and has no job_title column — they'd require a schema migration.
 *
 * null-mapping means "Don't include in import" — rendered as the
 * dropdown default for unmatched columns.
 */
/**
 * Push 4 (A4) — minimal custom-field def shape consumed by the CSV
 * import. Same source-of-truth columns the More Filters + Edit
 * Columns drawers use; the type is duplicated locally so the spec
 * (used in client + server import paths) stays import-light.
 */
export interface ImportCustomFieldDef {
  id: string
  name: string
  fieldType: string
  archivedAt: string | Date | null
}

/**
 * MappingChoice is the value selected per CSV column in the wizard's
 * "Maps to" dropdown. Either an intrinsic ImportableField OR a
 * `cf:<fieldId>` token pointing at a non-archived custom field
 * definition on this org.
 */
export type MappingChoice = ImportableField | `cf:${string}`

export function isCustomFieldMapping(choice: MappingChoice | null): choice is `cf:${string}` {
  return typeof choice === "string" && choice.startsWith("cf:")
}

export function customFieldIdFromMapping(choice: `cf:${string}`): string {
  return choice.slice(3)
}

export function buildCustomFieldMapping(fieldId: string): `cf:${string}` {
  return `cf:${fieldId}`
}

export const IMPORTABLE_FIELDS = [
  "fullName",
  "firstName",
  "lastName",
  "primaryEmail",
  "primaryPhone",
  "secondaryEmail",
  "secondaryPhone",
  "companyName",
  "contactType",
  "lifecycleStatus",
  "leadSource",
  "sourceDetail",
  "tags",
  "ownerUserId",
  "notes",
  "website",
  "instagramHandle",
  "mailingStreet",
  "mailingCity",
  "mailingState",
  "mailingPostalCode",
] as const
export type ImportableField = (typeof IMPORTABLE_FIELDS)[number]

export const FIELD_LABELS: Record<ImportableField, string> = {
  fullName: "Full name (auto-split)",
  firstName: "First name",
  lastName: "Last name",
  primaryEmail: "Primary email",
  primaryPhone: "Primary phone",
  secondaryEmail: "Secondary email",
  secondaryPhone: "Secondary phone",
  companyName: "Company (by name)",
  contactType: "Contact type",
  lifecycleStatus: "Lifecycle status",
  leadSource: "Lead source",
  sourceDetail: "Source detail",
  tags: "Tags (comma / semicolon-separated)",
  ownerUserId: "Owner (by email)",
  notes: "Notes",
  website: "Website",
  instagramHandle: "Instagram handle",
  mailingStreet: "Mailing — street",
  mailingCity: "Mailing — city",
  mailingState: "Mailing — state",
  mailingPostalCode: "Mailing — ZIP",
}

/**
 * Push 2c.1 — alias-array smart match. Each entry lists the headers
 * (post-normalization: lowercased, non-alphanumeric stripped) that
 * should auto-map to the field. autoMapHeaders inverts this into a
 * lookup. Multiple synonyms per field cover HubSpot / Mailchimp / etc.
 * export conventions.
 */
const FIELD_ALIASES: Record<ImportableField, string[]> = {
  fullName: ["fullname", "name", "contactname", "displayname"],
  firstName: ["firstname", "first", "givenname", "fname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname", "lname"],
  primaryEmail: ["email", "emailaddress", "primaryemail", "workemail", "contactemail"],
  primaryPhone: [
    "phone",
    "phonenumber",
    "telephone",
    "tel",
    "mobile",
    "mobilephone",
    "cellphone",
    "cell",
    "primaryphone",
    "workphone",
  ],
  secondaryEmail: ["secondaryemail", "email2", "alternateemail", "otheremail"],
  secondaryPhone: ["secondaryphone", "phone2", "alternatephone", "homephone"],
  companyName: [
    "company",
    "companyname",
    "organization",
    "organisation",
    "account",
    "accountname",
    "employer",
  ],
  contactType: ["contacttype", "type", "category"],
  lifecycleStatus: ["lifecyclestage", "lifecyclestatus", "stage", "status", "leadstatus"],
  leadSource: ["leadsource", "source", "originalsource", "leadorigin"],
  sourceDetail: ["sourcedetail", "sourceinfo", "campaign"],
  tags: ["tags", "labels", "categories"],
  ownerUserId: ["owner", "contactowner", "assignedto", "salesrep", "owneremail"],
  notes: ["notes", "note", "description", "comments"],
  website: ["website", "url", "homepage", "websiteurl"],
  instagramHandle: ["instagram", "instagramhandle", "ig", "instagramusername"],
  mailingStreet: [
    "street",
    "address",
    "address1",
    "streetaddress",
    "mailingaddress",
    "mailingstreet",
  ],
  mailingCity: ["city", "mailingcity"],
  mailingState: ["state", "province", "region", "mailingstate"],
  mailingPostalCode: ["zip", "zipcode", "postalcode", "postcode", "mailingzip"],
}

const HEADER_HINTS: Record<string, ImportableField> = (() => {
  const out: Record<string, ImportableField> = {}
  for (const field of IMPORTABLE_FIELDS) {
    for (const alias of FIELD_ALIASES[field]) {
      out[alias] = field
    }
  }
  return out
})()

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Push 4 (A4) — per-type cell coercion for custom field imports.
 * Returns the raw string to forward to the server (which will JSON-
 * parse / cast per the field's type) or undefined to drop the cell
 * with a row-level warning. Surface-level validation only — the
 * server-side validator in src/modules/custom-fields/validators.ts
 * is the authoritative check.
 */
function coerceCustomFieldCell(
  def: ImportCustomFieldDef,
  raw: string,
  warnings: string[],
): string | undefined {
  switch (def.fieldType) {
    case "number":
    case "currency":
      if (Number.isFinite(Number(raw))) return raw
      warnings.push(`Custom field "${def.name}" expects a number; "${raw}" was skipped`)
      return undefined
    case "date":
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
      warnings.push(`Custom field "${def.name}" expects YYYY-MM-DD; "${raw}" was skipped`)
      return undefined
    case "checkbox": {
      const lower = raw.toLowerCase()
      if (["true", "yes", "y", "1"].includes(lower)) return "true"
      if (["false", "no", "n", "0"].includes(lower)) return "false"
      warnings.push(`Custom field "${def.name}" expects true/false; "${raw}" was skipped`)
      return undefined
    }
    default:
      // text / multiline / email / phone / url / select-style /
      // reference / file / image — accept the raw value; the
      // server-side validator does authoritative checks.
      return raw
  }
}

export function autoMapHeaders(
  headers: string[],
  customFields: ImportCustomFieldDef[] = [],
): (MappingChoice | null)[] {
  // Push 4 (A4) — extend HEADER_HINTS with per-org custom-field name
  // aliases. Archived defs are excluded so they can't be auto-mapped
  // (a UI surface that wouldn't take new writes anyway). The
  // intrinsic-side aliases still win; only previously-unmatched
  // headers fall through to the custom-field check.
  const cfHints = new Map<string, `cf:${string}`>()
  for (const def of customFields) {
    if (def.archivedAt) continue
    cfHints.set(normalizeHeader(def.name), buildCustomFieldMapping(def.id))
  }
  return headers.map((h) => {
    const n = normalizeHeader(h)
    const intrinsic = HEADER_HINTS[n]
    if (intrinsic) return intrinsic
    return cfHints.get(n) ?? null
  })
}

// ─── Field-type sniffing (mapping-step warnings) ───────────────────────

/**
 * Push 2c.1 — sniff "what does this column LOOK like" from a sample
 * of values. Used in the mapping step to surface an amber warning when
 * the user's chosen mapping disagrees with the apparent shape (e.g.
 * column looks like email addresses but is mapped to First name).
 */
export type DetectedType = "email" | "phone" | "date" | "url" | null

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SLASH_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/
const URL_RE = /^https?:\/\//i

export function detectFieldType(samples: string[]): DetectedType {
  const cleaned = samples.map((s) => s.trim()).filter((s) => s.length > 0)
  if (cleaned.length === 0) return null
  // Need ≥ 60% of samples to match for confidence — mixed columns
  // shouldn't get tagged.
  const threshold = Math.max(1, Math.ceil(cleaned.length * 0.6))
  let email = 0
  let phone = 0
  let date = 0
  let url = 0
  for (const v of cleaned) {
    if (EMAIL_RE.test(v)) email++
    if (URL_RE.test(v)) url++
    if (ISO_DATE_RE.test(v) || SLASH_DATE_RE.test(v)) date++
    const digits = v.replace(/\D/g, "")
    if (digits.length >= 7) phone++
  }
  if (email >= threshold) return "email"
  if (url >= threshold) return "url"
  if (date >= threshold) return "date"
  if (phone >= threshold) return "phone"
  return null
}

/**
 * Which mappings are "compatible" with a sniffed detection. The mapping
 * step renders an amber warning when the chosen mapping isn't in this
 * set for the detected type. fullName is OK for any detected type
 * because it's a permissive catch-all.
 */
export function detectionAgreesWithMapping(
  detected: DetectedType,
  mapping: ImportableField | null,
): boolean {
  if (detected === null) return true
  if (mapping === null) return true // user said "don't import" — no warning
  if (mapping === "fullName") return true
  if (detected === "email")
    return mapping === "primaryEmail" || mapping === "secondaryEmail" || mapping === "ownerUserId"
  if (detected === "phone") return mapping === "primaryPhone" || mapping === "secondaryPhone"
  if (detected === "url") return mapping === "website"
  // detected === "date" — no date-shaped contact field in V1, always disagree.
  return false
}

/**
 * First non-empty sample from a column index, truncated for display.
 * Powers the "example: jane@acme.com" hint in the mapping dropdown.
 */
export function firstNonEmptySample(rows: string[][], columnIndex: number, max = 40): string {
  for (const row of rows) {
    const v = (row[columnIndex] ?? "").trim()
    if (v.length === 0) continue
    return v.length <= max ? v : v.slice(0, max - 1) + "…"
  }
  return ""
}

// ─── Row validation ────────────────────────────────────────────────────

const emailSchema = z.union([z.email(), z.literal("")])
const urlSchema = z.union([z.url(), z.literal("")])

/**
 * Push 2c.1 — split a fullName into first + last on the FIRST space.
 * "Jane Doe" → ["Jane", "Doe"]. "Jane Mary Doe" → ["Jane", "Mary Doe"].
 * Single word "Jane" → ["Jane", ""] (caller decides if missing last
 * counts as a row-level error). Trailing whitespace tolerated.
 */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim()
  if (trimmed.length === 0) return { firstName: "", lastName: "" }
  const space = trimmed.indexOf(" ")
  if (space === -1) return { firstName: trimmed, lastName: "" }
  return {
    firstName: trimmed.slice(0, space).trim(),
    lastName: trimmed.slice(space + 1).trim(),
  }
}

/**
 * Push 2c.1 — parse a tag cell. Accepts both comma AND semicolon
 * separators (HubSpot exports use ; for multi-value; Mailchimp uses ,).
 * Empty / oversized tokens dropped. Lowercase normalization NOT applied
 * here — the create/update layer expects case-as-typed.
 */
export function parseTagsCell(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 80)
}

/**
 * Turn a raw CSV row + field mapping into a CleanRow keyed by contact
 * field. Validation errors are surfaced inline (one per row) so the
 * preview can show "what would actually import" without dropping the
 * whole row from the dataset.
 *
 * Push 2c.1 — fullName auto-splits to first + last; explicit
 * firstName/lastName mappings win.
 */
export interface CleanRow {
  rowIndex: number // 1-based for user-facing error reporting
  values: Partial<Record<ImportableField, string>>
  /** Push 4 (A4) — raw string values for any cf:* mappings, keyed by
   * custom field definition id. The server import action turns these
   * into a custom_fields jsonb on the contact row, with per-type
   * coercion (numbers, booleans, multi-select arrays). */
  customValues: Record<string, string>
  errors: string[]
  warnings: string[]
}

export function buildCleanRow(
  rowIndex: number,
  rawRow: string[],
  mapping: (MappingChoice | null)[],
  customFields: ImportCustomFieldDef[] = [],
): CleanRow {
  const values: Partial<Record<ImportableField, string>> = {}
  const customValues: Record<string, string> = {}
  const errors: string[] = []
  const warnings: string[] = []
  const cfDefById = new Map(customFields.map((d) => [d.id, d]))
  for (let i = 0; i < mapping.length; i++) {
    const field = mapping[i]
    if (!field) continue
    const raw = (rawRow[i] ?? "").trim()
    if (!raw) continue
    if (isCustomFieldMapping(field)) {
      const fieldId = customFieldIdFromMapping(field)
      const def = cfDefById.get(fieldId)
      // Defensive: drop mappings whose def has gone (deleted between
      // mapping step and import submit).
      if (!def) continue
      // Per-type validation: surface a warning + drop when the cell
      // value doesn't look right for the field's type. The server
      // validator (host-helpers.prepareCustomFieldsForCreate) does
      // the authoritative check; this is just a friendlier UX so
      // import error rows are smaller.
      const typed = coerceCustomFieldCell(def, raw, warnings)
      if (typed === undefined) continue
      customValues[fieldId] = typed
      continue
    }
    values[field] = raw
  }

  // fullName auto-split. Explicit first/last mappings win, so we only
  // fill the absent half.
  if (values.fullName) {
    const split = splitFullName(values.fullName)
    if (!values.firstName && split.firstName) values.firstName = split.firstName
    if (!values.lastName && split.lastName) values.lastName = split.lastName
  }

  // lastName is the only HARD-required field (a row identified only by
  // first name + email is still useful — HubSpot lets you create
  // "First-name-only" leads). Email-only is also acceptable IF the
  // wizard chose to map email separately (covers spreadsheets from
  // form fills with no name parsed yet).
  const hasIdentifier = !!values.lastName || !!values.primaryEmail || !!values.firstName
  if (!hasIdentifier) {
    errors.push("Row has no first name, last name, or email — nothing to identify the contact")
  }
  // firstName defaults to "Unknown" at create time when missing but
  // we have lastName / email. Surface as a warning so the user sees it.
  if (!values.firstName && hasIdentifier && !values.lastName) {
    warnings.push("First name missing — will be imported as just the email/last-name")
  }

  if (values.primaryEmail) {
    const r = emailSchema.safeParse(values.primaryEmail)
    if (!r.success) {
      warnings.push("primaryEmail is not a valid email — will be imported without it")
      delete values.primaryEmail
    }
  }
  if (values.secondaryEmail) {
    const r = emailSchema.safeParse(values.secondaryEmail)
    if (!r.success) {
      warnings.push("secondaryEmail is not a valid email — will be imported without it")
      delete values.secondaryEmail
    }
  }
  if (values.website) {
    const r = urlSchema.safeParse(values.website)
    if (!r.success) {
      warnings.push("website is not a valid URL — will be imported without it")
      delete values.website
    }
  }
  if (values.contactType) {
    const matched = caseInsensitiveEnumMatch(values.contactType, CONTACT_TYPES)
    if (matched) {
      values.contactType = matched
    } else {
      warnings.push(
        `contactType "${values.contactType}" is not a valid type — will be imported without it`,
      )
      delete values.contactType
    }
  }
  if (values.lifecycleStatus) {
    const matched = caseInsensitiveEnumMatch(values.lifecycleStatus, LIFECYCLE_STATUSES)
    if (matched) {
      values.lifecycleStatus = matched
    } else {
      warnings.push(
        `lifecycleStatus "${values.lifecycleStatus}" is not a valid status — will be imported without it`,
      )
      delete values.lifecycleStatus
    }
  }

  return { rowIndex, values, customValues, errors, warnings }
}

/**
 * Case-insensitive enum match — returns the canonical-case enum value
 * if the input matches any allowed value (case-folded), else null.
 * Used by contactType + lifecycleStatus normalization so that
 * "customer", "Customer", "CUSTOMER" all collapse to whatever the
 * V1 enum spelling is.
 */
function caseInsensitiveEnumMatch<T extends readonly string[]>(
  input: string,
  allowed: T,
): T[number] | null {
  const lower = input.trim().toLowerCase()
  for (const candidate of allowed) {
    if (candidate.toLowerCase() === lower) return candidate
  }
  return null
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

// ─── CSV-internal duplicate detection (preview-step warnings) ──────────

/**
 * Push 2c.1 — scan all clean rows for duplicate primaryEmail values
 * within the CSV itself. Returns a map of rowIndex → "this is a
 * duplicate of row X" (first occurrence wins). Rows with no email
 * are excluded — phone-only collisions are noisier and HubSpot's
 * pattern is email-centric here.
 */
export function findCsvInternalDuplicates(rows: CleanRow[]): Map<number, number> {
  const firstByEmail = new Map<string, number>()
  const dupes = new Map<number, number>()
  for (const r of rows) {
    const email = (r.values.primaryEmail ?? "").trim().toLowerCase()
    if (!email) continue
    const first = firstByEmail.get(email)
    if (first === undefined) {
      firstByEmail.set(email, r.rowIndex)
    } else {
      dupes.set(r.rowIndex, first)
    }
  }
  return dupes
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
