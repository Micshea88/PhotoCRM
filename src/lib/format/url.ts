/**
 * URL normalization helper — CRM-wide standard.
 *
 * Per the V1 Roadmap "URL Validation Standard" row + the PIVOTS_LEDGER
 * canonical rule: user-typed URLs in form fields should be forgiving.
 * Auto-prepend `https://` when the user types `www.example.com` or
 * `example.com` rather than rejecting the input as "not a URL".
 *
 * Apply at FORM-SUBMIT time, not at every keystroke. Letting the user
 * see what they typed is useful; rewriting their input mid-type is
 * jarring. The Zod `z.url()` schemas on the action side stay strict —
 * the form is responsible for handing them a normalized value.
 *
 * Returns:
 *   - "" or null/undefined input  → "" (caller decides null vs empty)
 *   - already starts with http:// or https://  → unchanged (trimmed)
 *   - already starts with another scheme (mailto:, tel:)  → unchanged
 *   - everything else  → prepends "https://"
 *
 * Notable non-behaviors:
 *   - Does NOT validate the rest of the URL — Zod `z.url()` is the
 *     authoritative check on the server side.
 *   - Does NOT strip trailing slashes or normalize case.
 *   - Does NOT add `www.` — the user controls subdomain choice.
 */
export function normalizeUrl(input: string | null | undefined): string {
  if (!input) return ""
  const trimmed = input.trim()
  if (trimmed === "") return ""
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^(mailto|tel|sms|ftp):/i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}
