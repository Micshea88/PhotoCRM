/**
 * Push 2c — pagination constants shared between the server filter-spec
 * (which enforces the cap + offset arithmetic) and the client
 * pagination footer (which renders the page-size selector).
 *
 * Lives in its own file so the client component can import these
 * constants without dragging the server-only filter-spec module
 * (which imports pg + org-context) into the client bundle.
 */

/**
 * Push 2c — hard cap on the contacts list scan. Server-side. Above
 * this, the page renders a "refine filters" banner instead of trying
 * to render or even count the full set. 10k is well above any single-
 * photographer studio's contact list; commercial agencies that need
 * more should use CSV export + an external dataset.
 */
export const CONTACTS_LIST_HARD_CAP = 10_000

export const CONTACTS_VALID_PAGE_SIZES = [25, 50, 100] as const
export type ContactsPageSize = (typeof CONTACTS_VALID_PAGE_SIZES)[number]
export const CONTACTS_DEFAULT_PAGE_SIZE: ContactsPageSize = 50
