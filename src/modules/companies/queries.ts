import "server-only"
import { and, eq, ilike, isNull } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { companies } from "./schema"

interface ListOptions {
  /** Include soft-deleted rows. Default false. */
  withDeleted?: boolean
}

/**
 * All non-deleted companies for the active org, ordered by name for stable
 * UI rendering. Pass `{ withDeleted: true }` to include tombstones (admin
 * tooling only — there is no V1 UI surface for restore-from-deleted yet).
 */
export async function listCompaniesForOrg(opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(companies)
      .where(opts.withDeleted ? undefined : isNull(companies.deletedAt))
      .orderBy(companies.name)
  })
}

export async function getCompanyForOrg(id: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(companies.id, id)
      : and(eq(companies.id, id), isNull(companies.deletedAt))
    const [row] = await tx.select().from(companies).where(where).limit(1)
    return row ?? null
  })
}

/**
 * Typeahead support: case-insensitive name match. The (organization_id,
 * name) partial unique index covers the leading-substring scan. Caller
 * limits the result count; a default of 10 keeps the dropdown tractable.
 *
 * The pattern includes a leading `%` so partial-anywhere matches work
 * ("planning" matches "Evergreen Planning"). For prefix-only (faster but
 * less forgiving), drop the leading wildcard.
 */
export async function searchCompaniesByName(q: string, limit = 10) {
  return withOrgContext(async (tx) => {
    return tx
      .select({
        id: companies.id,
        name: companies.name,
        website: companies.website,
        category: companies.category,
      })
      .from(companies)
      .where(and(ilike(companies.name, `%${q}%`), isNull(companies.deletedAt)))
      .orderBy(companies.name)
      .limit(limit)
  })
}
