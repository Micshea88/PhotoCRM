import { z } from "zod"

/**
 * No write-action input schemas in V1 — FAQ entries are seeded by the
 * migration and edited at the application layer (admin-only paths not
 * yet built). When a /settings/help admin UI lands, add CRUD input
 * schemas here.
 *
 * Reserved for future:
 *   - createFaqEntryInput / updateFaqEntryInput / deleteFaqEntryInput
 *   - reorderFaqEntriesInput
 */

export const searchFaqInput = z.object({
  q: z.string().trim().max(200).optional(),
})

export type SearchFaqInput = z.infer<typeof searchFaqInput>
