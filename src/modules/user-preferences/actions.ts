"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { userPreferences } from "./schema"
import { deleteUserPreferenceInput, setUserPreferenceInput, type UserPreferenceKey } from "./types"

/**
 * Push 3 (C2) — set / delete user preferences.
 *
 * Upserts by `(user_id, organization_id, key)`. The partial unique
 * indexes in schema.ts make this idempotent across the NULL-org and
 * scoped-org cases.
 *
 * Audit: every state-changing action writes an audit row per the
 * hard-rule convention (`user_preferences.set` /
 * `user_preferences.deleted`). Metadata kept light to keep the
 * audit-log signal usable — these can fire frequently (nav toggle).
 *
 * Why orgAction (not authAction): user_preferences reads use RLS
 * scoped to `app.current_user_id`, which is set by orgAction's
 * transaction-local pg settings. authAction doesn't set those
 * settings, so an authAction-based write would not satisfy the RLS
 * WITH CHECK clause. Since every nav-toggle happens inside an
 * authenticated app shell that already has an active org, orgAction
 * is the right fit.
 */

export const setUserPreference = orgAction
  .metadata({ actionName: "user_preferences.set" })
  .inputSchema(setUserPreferenceInput)
  .action(async ({ parsedInput, ctx }) => {
    const { key, value, organizationId = null } = parsedInput
    const userId = ctx.session.user.id

    // Look up existing row to decide UPDATE vs INSERT. Could be done
    // with ON CONFLICT but the partial-unique indexes split the
    // namespace by NULL-vs-not, which makes a single ON CONFLICT
    // clause awkward. Two-step is simpler and matches the codebase's
    // existing "select-then-write" idiom for upserts.
    const orgCond =
      organizationId === null
        ? isNull(userPreferences.organizationId)
        : eq(userPreferences.organizationId, organizationId)
    const [existing] = await ctx.db
      .select({ id: userPreferences.id })
      .from(userPreferences)
      .where(and(eq(userPreferences.userId, userId), orgCond, eq(userPreferences.key, key)))
      .limit(1)

    if (existing) {
      await ctx.db
        .update(userPreferences)
        .set({ value, updatedAt: new Date() })
        .where(eq(userPreferences.id, existing.id))
    } else {
      await ctx.db.insert(userPreferences).values({
        id: createId(),
        userId,
        organizationId,
        key,
        value,
      })
    }

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "user_preferences.set",
      {
        resourceType: "user_preference",
        metadata: { key, organizationId: organizationId ?? null },
      },
    )

    // revalidatePath is a no-op inside this action's tx and the
    // pref-driven UI surfaces (sidebar, future view defaults)
    // re-render at the next request boundary. We don't know which
    // route to revalidate at action-call time; the layout reads
    // fresh on next navigation.
    revalidatePath("/")
    return { ok: true }
  })

export const deleteUserPreference = orgAction
  .metadata({ actionName: "user_preferences.delete" })
  .inputSchema(deleteUserPreferenceInput)
  .action(async ({ parsedInput, ctx }) => {
    const { key, organizationId = null } = parsedInput
    const userId = ctx.session.user.id
    const orgCond =
      organizationId === null
        ? isNull(userPreferences.organizationId)
        : eq(userPreferences.organizationId, organizationId)
    await ctx.db
      .delete(userPreferences)
      .where(and(eq(userPreferences.userId, userId), orgCond, eq(userPreferences.key, key)))
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "user_preferences.deleted",
      {
        resourceType: "user_preference",
        metadata: { key, organizationId: organizationId ?? null },
      },
    )
    revalidatePath("/")
    return { ok: true, key: key satisfies UserPreferenceKey }
  })
