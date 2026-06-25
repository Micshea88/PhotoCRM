"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { SHARE_LINK_EXPIRATION_OPTIONS } from "@/modules/files/share-link-core"
import { orgPreferences } from "./schema"

/**
 * Org-preferences actions (Commit 3, Phase E). Upserts the single per-org
 * preferences row. "Custom date…" is NOT a valid org-wide default (a default
 * must be a recurring duration, not a fixed calendar date), so it's excluded
 * from the accepted set.
 */
const settableExpirations = SHARE_LINK_EXPIRATION_OPTIONS.filter((o) => o !== "Custom date…") as [
  string,
  ...string[],
]

export const setDefaultShareExpiration = orgAction
  .metadata({ actionName: "org_preferences.set_default_share_expiration" })
  .inputSchema(z.object({ expiration: z.enum(settableExpirations) }))
  .action(async ({ parsedInput, ctx }) => {
    const [existing] = await ctx.db
      .select({ id: orgPreferences.id })
      .from(orgPreferences)
      .where(eq(orgPreferences.organizationId, ctx.activeOrg.id))
      .limit(1)

    if (existing) {
      await ctx.db
        .update(orgPreferences)
        .set({ defaultShareLinkExpiration: parsedInput.expiration, updatedAt: new Date() })
        .where(eq(orgPreferences.id, existing.id))
    } else {
      await ctx.db.insert(orgPreferences).values({
        id: createId(),
        organizationId: ctx.activeOrg.id,
        defaultShareLinkExpiration: parsedInput.expiration,
      })
    }

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "org_preferences.updated",
      {
        resourceType: "org_preferences",
        resourceId: ctx.activeOrg.id,
        metadata: { defaultShareLinkExpiration: parsedInput.expiration },
      },
    )
    revalidatePath("/settings/preferences")
    return { ok: true }
  })
