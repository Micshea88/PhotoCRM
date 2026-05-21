/**
 * `contactLabel` — the canonical display label for a contact (the
 * "Contact disambiguation display rule"). Two same-named contacts
 * must always be distinguishable at a glance in lists, pickers,
 * autocompletes, association fields, and search results.
 *
 * Pure function. No DB access. The caller resolves the company by
 * `companyId` (via `getCompanyForOrg` / `searchCompaniesByName` /
 * the contacts query that already joins) and passes either the
 * `companyName` string or `null` / `undefined` for "no company".
 *
 * Output (updated 2026-05-21 per PIVOTS_LEDGER LOC1 — natural
 * reading order "First Last", not "Last, First"):
 *   - with companyName: `"First Last — Company"`
 *   - without companyName, with primaryEmail: `"First Last — email@example.com"`
 *   - without either: `"First Last"`
 *
 * Edge cases handled defensively:
 *   - Missing first OR last name: falls back to whichever is present.
 *   - Both names missing (shouldn't happen — both are NOT NULL on the
 *     schema): returns `"(unknown contact)"` rather than throw.
 */
export interface ContactLabelInput {
  firstName: string | null
  lastName: string | null
  primaryEmail?: string | null
}

export function contactLabel(contact: ContactLabelInput, companyName?: string | null): string {
  const first = (contact.firstName ?? "").trim()
  const last = (contact.lastName ?? "").trim()

  let name: string
  if (first && last) {
    name = `${first} ${last}`
  } else if (first || last) {
    name = first || last
  } else {
    name = "(unknown contact)"
  }

  if (companyName && companyName.trim().length > 0) {
    return `${name} — ${companyName.trim()}`
  }
  const email = contact.primaryEmail?.trim()
  if (email) {
    return `${name} — ${email}`
  }
  return name
}
