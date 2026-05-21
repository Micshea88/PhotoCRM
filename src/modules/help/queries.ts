import "server-only"
import { and, ilike, isNull, or, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { faqEntries } from "./schema"

/**
 * FAQ entries are GLOBAL across the product (no organization_id, no
 * RLS). Every signed-in user sees the same set. Reads do NOT go through
 * `withOrgContext` — we use the raw db handle.
 *
 * Returns active (non-deleted) entries, ordered by category then
 * display_order then question. Category-grouping is the responsibility
 * of the rendering UI.
 */
export async function listFaqEntries(opts: { q?: string } = {}) {
  const q = opts.q?.trim()
  if (q && q.length > 0) {
    const pattern = `%${q}%`
    return db
      .select()
      .from(faqEntries)
      .where(
        and(
          isNull(faqEntries.deletedAt),
          or(ilike(faqEntries.question, pattern), ilike(faqEntries.answer, pattern)),
        ),
      )
      .orderBy(faqEntries.category, faqEntries.displayOrder, faqEntries.question)
  }
  return db
    .select()
    .from(faqEntries)
    .where(isNull(faqEntries.deletedAt))
    .orderBy(faqEntries.category, faqEntries.displayOrder, faqEntries.question)
}

/**
 * All distinct categories in seeded order. Used by the /faq page's
 * left-rail nav.
 */
export async function listFaqCategories() {
  const rows = await db
    .select({ category: faqEntries.category })
    .from(faqEntries)
    .where(isNull(faqEntries.deletedAt))
    .orderBy(faqEntries.category, faqEntries.displayOrder)
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of rows) {
    const c = r.category ?? ""
    if (!seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out
}

// Re-exported convenience.
export const _sql = sql
