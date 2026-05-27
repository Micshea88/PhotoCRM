import { z } from "zod"

/**
 * Push 3 (C2) — user_preferences input schemas.
 *
 * The store is intentionally schemaless on the value side — each
 * preference key carries its own value shape. Consumers parse the
 * jsonb value against their own zod schema when reading. This file
 * holds the WRITE input schema (key + value + optional org scope)
 * and the known-key enum so consumers can refer to keys by symbol.
 *
 * Known keys (V1):
 *   - `nav_collapsed`: boolean. organization_id = null (UI pref
 *     follows the user across orgs).
 *   - `nav_settings_expanded`: boolean. Inline-expand state for the
 *     Settings parent group in the desktop sidebar (P3 post-C2 nav
 *     hotfix). organization_id = null (UI pref follows the user).
 *
 * Naming convention: snake_case, no namespace dots. Matches the C2
 * `nav_collapsed` precedent — keeps related keys easy to grep by
 * prefix (`nav_*` for nav UI prefs, future modules pick their own).
 *
 * Future keys land here as they ship. Adding a key here does NOT
 * require a migration — the storage is jsonb.
 */

export const USER_PREFERENCE_KEYS = ["nav_collapsed", "nav_settings_expanded"] as const
export type UserPreferenceKey = (typeof USER_PREFERENCE_KEYS)[number]

export const userPreferenceKeySchema = z.enum(USER_PREFERENCE_KEYS)

/**
 * Per-key value schemas. The action layer uses this to parse the
 * incoming `value` field against the right shape for the chosen key.
 */
export const userPreferenceValueSchemas: Record<UserPreferenceKey, z.ZodType> = {
  nav_collapsed: z.boolean(),
  nav_settings_expanded: z.boolean(),
}

export const setUserPreferenceInput = z
  .object({
    key: userPreferenceKeySchema,
    value: z.unknown(),
    organizationId: z.string().min(1).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const schema = userPreferenceValueSchemas[data.key]
    const result = schema.safeParse(data.value)
    if (!result.success) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `Invalid value for preference "${data.key}": ${result.error.message}`,
      })
    }
  })

export const deleteUserPreferenceInput = z.object({
  key: userPreferenceKeySchema,
  organizationId: z.string().min(1).nullable().optional(),
})

export type SetUserPreferenceInput = z.infer<typeof setUserPreferenceInput>
export type DeleteUserPreferenceInput = z.infer<typeof deleteUserPreferenceInput>
