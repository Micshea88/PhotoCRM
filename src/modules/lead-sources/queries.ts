import "server-only"
import { eq, isNotNull, sql } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { orgLeadSourceOverrides } from "./schema"
import { contacts } from "@/modules/contacts/schema"

/**
 * Hidden lead-source names for the active org. Used by:
 *   - LeadSourceCombobox (filters them out of the dropdown)
 *   - Settings page (renders the toggle state per source)
 *
 * Returns an array of source-name strings (not the row objects).
 */
export async function listHiddenLeadSources(): Promise<string[]> {
  return withOrgContext(async (tx) => {
    const rows = await tx
      .select({ sourceName: orgLeadSourceOverrides.sourceName })
      .from(orgLeadSourceOverrides)
      .where(eq(orgLeadSourceOverrides.status, "hidden"))
    return rows.map((r) => r.sourceName)
  })
}

/**
 * Per-source usage count. Powers the settings page's "Used by N contacts"
 * badge next to each custom value. Excludes archived + deleted contacts
 * (they shouldn't influence the displayed count). Returns a map for
 * O(1) lookup in the renderer.
 */
export async function countContactsPerLeadSource(): Promise<Map<string, number>> {
  return withOrgContext(async (tx) => {
    const rows = await tx
      .select({
        sourceName: contacts.leadSource,
        count: sql<number>`count(*)::int`,
      })
      .from(contacts)
      .where(
        sql`${contacts.leadSource} IS NOT NULL AND ${contacts.deletedAt} IS NULL AND ${contacts.archivedAt} IS NULL`,
      )
      .groupBy(contacts.leadSource)
    const map = new Map<string, number>()
    for (const r of rows) {
      if (r.sourceName) map.set(r.sourceName, r.count)
    }
    return map
  })
}

// Re-export so the module's queries.ts file is the canonical source of
// truth for what's available to consumers.
export { isNotNull }
