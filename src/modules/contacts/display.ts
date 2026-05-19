/**
 * `contactLabel` — the canonical display label for a contact, per
 * Requirements §6.1 ("Contact disambiguation display rule, mandatory,
 * applies everywhere"). Two same-named contacts must always be
 * distinguishable at a glance in lists, pickers, autocompletes,
 * association fields, and search results.
 *
 * Pure function. No DB access. The caller resolves the company by
 * `companyId` (via `getCompanyForOrg` / `searchCompaniesByName` /
 * the contacts query that already joins) and passes either the
 * `companyName` string or `null` / `undefined` for "no company".
 *
 * Output:
 *   - with companyName: `"Last, First — Company"`
 *   - without companyName, with primaryEmail: `"Last, First — email@example.com"`
 *   - without either: `"Last, First"`
 *
 * Edge cases handled defensively:
 *   - Missing first/last name: falls back to whichever is present.
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
  if (last && first) {
    name = `${last}, ${first}`
  } else if (last || first) {
    name = last || first
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
