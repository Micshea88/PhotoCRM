import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { getOrgContext, withOrgContext } from "@/lib/org-context"
import type * as schema from "@/db/schema"
import { userPreferences } from "./schema"
import type { UserPreferenceKey } from "./types"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Push 3 (C2) — read a single preference value for the current
 * user. Returns null when the preference is unset.
 *
 * RLS scopes the read to the current user via the
 * `app.current_user_id` GUC set by orgAction / authAction; the
 * explicit `user_id` filter below also lets the query use the
 * `user_preferences_user_org_idx` index.
 *
 * Org scoping: pass `organizationId` to scope to a specific org's
 * pref; pass null (default) to read the user-global pref. The two
 * are stored as separate rows — there is no fallback between them;
 * callers pick one explicitly.
 */
export async function getUserPreference(
  key: UserPreferenceKey,
  organizationId: string | null = null,
): Promise<unknown> {
  const ctx = getOrgContext()
  if (!ctx?.userId) return null
  return withOrgContext(async (tx) => {
    return readSingle(tx, ctx.userId, key, organizationId)
  })
}

/**
 * Parametric variant for callers inside an orgAction transaction.
 * Mirrors the A3 hotfix pattern (`listFieldDefinitionsForRecordTypeWithDb`)
 * so the read works from action bodies where ALS isn't populated.
 */
export async function getUserPreferenceWithDb(
  tx: DbHandle,
  userId: string,
  key: UserPreferenceKey,
  organizationId: string | null = null,
): Promise<unknown> {
  return readSingle(tx, userId, key, organizationId)
}

async function readSingle(
  tx: DbHandle,
  userId: string,
  key: UserPreferenceKey,
  organizationId: string | null,
): Promise<unknown> {
  const orgCond =
    organizationId === null
      ? isNull(userPreferences.organizationId)
      : eq(userPreferences.organizationId, organizationId)
  const [row] = await tx
    .select({ value: userPreferences.value })
    .from(userPreferences)
    .where(and(eq(userPreferences.userId, userId), orgCond, eq(userPreferences.key, key)))
    .limit(1)
  return row?.value ?? null
}

/**
 * Read all preferences for the current user, optionally scoped to
 * an org (pass `null` for user-global only, `undefined` for
 * everything across orgs + global). Returns a map keyed by
 * preference key.
 */
export async function listUserPreferences(
  organizationId?: string | null,
): Promise<Record<string, unknown>> {
  const ctx = getOrgContext()
  if (!ctx?.userId) return {}
  return withOrgContext(async (tx) => {
    const conds = [eq(userPreferences.userId, ctx.userId)]
    if (organizationId === null) {
      conds.push(isNull(userPreferences.organizationId))
    } else if (typeof organizationId === "string") {
      conds.push(eq(userPreferences.organizationId, organizationId))
    }
    const rows = await tx
      .select({ key: userPreferences.key, value: userPreferences.value })
      .from(userPreferences)
      .where(and(...conds))
    const out: Record<string, unknown> = {}
    for (const r of rows) out[r.key] = r.value
    return out
  })
}
