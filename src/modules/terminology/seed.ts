import { createId } from "@paralleldrive/cuid2"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { terminologyMap } from "./schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * V1 photographer pack. The single configuration that ships in V1 per
 * Requirements §4.7. Future verticals (planner, videographer, venue) would
 * add a sibling pack and a chooser; out of scope for V1.
 *
 * Keys correspond to product objects whose UI labels are user-visible. The
 * canonical decision is `project → "Event"`; the rest seed sensible defaults
 * so labels render correctly before each module is wired in. Adding a key
 * here is cheap; missing one logs a warning and falls back to the capitalized
 * key (see getLabel in queries.ts).
 */
const PHOTOGRAPHER_PACK: Record<string, { singular: string; plural: string }> = {
  project: { singular: "Event", plural: "Events" },
  contact: { singular: "Contact", plural: "Contacts" },
  opportunity: { singular: "Opportunity", plural: "Opportunities" },
  task: { singular: "Task", plural: "Tasks" },
  company: { singular: "Company", plural: "Companies" },
  pipeline: { singular: "Pipeline", plural: "Pipelines" },
}

/**
 * Idempotent. Uses (organization_id, object_key) unique index to no-op on
 * re-run. The caller's connection must be able to write to terminology_map:
 *   - dev seed: scripts/seed.ts uses DATABASE_URL_ADMIN, which bypasses RLS.
 *   - production: must be invoked from inside an orgAction tx where
 *     app.current_org is set to this orgId — otherwise the policy's WITH
 *     CHECK rejects the inserts.
 */
export async function seedTerminologyForOrg(db: DbHandle, orgId: string) {
  const values = Object.entries(PHOTOGRAPHER_PACK).map(([objectKey, { singular, plural }]) => ({
    id: createId(),
    organizationId: orgId,
    objectKey,
    labelSingular: singular,
    labelPlural: plural,
  }))
  await db
    .insert(terminologyMap)
    .values(values)
    .onConflictDoNothing({ target: [terminologyMap.organizationId, terminologyMap.objectKey] })
}
