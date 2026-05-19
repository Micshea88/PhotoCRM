import "server-only"
import { eq } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { log } from "@/lib/log"
import { terminologyMap } from "./schema"

export interface Label {
  singular: string
  plural: string
}

/**
 * Full label map for the current org (Record<object_key, Label>). Resolves
 * org/role from AsyncLocalStorage via `withOrgContext`; the RLS policy on
 * `terminology_map` enforces scoping at the database level — no explicit
 * organization_id where-clause is necessary or wanted here.
 */
export async function getTerminologyMap(): Promise<Record<string, Label>> {
  return withOrgContext(async (tx) => {
    const rows = await tx
      .select({
        objectKey: terminologyMap.objectKey,
        labelSingular: terminologyMap.labelSingular,
        labelPlural: terminologyMap.labelPlural,
      })
      .from(terminologyMap)
    const out: Record<string, Label> = {}
    for (const r of rows) {
      out[r.objectKey] = { singular: r.labelSingular, plural: r.labelPlural }
    }
    return out
  })
}

/**
 * Look up the label for a single object key. Returns a capitalized fallback
 * (e.g., "project" → {singular: "Project", plural: "Projects"}) and logs a
 * warning if no row is found. The fallback is intentional: a missing
 * terminology row is a seeding gap, not a user-facing error — render
 * something sensible rather than crashing the page.
 */
export async function getLabel(objectKey: string): Promise<Label> {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select({
        labelSingular: terminologyMap.labelSingular,
        labelPlural: terminologyMap.labelPlural,
      })
      .from(terminologyMap)
      .where(eq(terminologyMap.objectKey, objectKey))
      .limit(1)
    if (!row) {
      log.warn({ objectKey }, "terminology: no label for object_key")
      const cap = objectKey.charAt(0).toUpperCase() + objectKey.slice(1)
      return { singular: cap, plural: cap + "s" }
    }
    return { singular: row.labelSingular, plural: row.labelPlural }
  })
}
