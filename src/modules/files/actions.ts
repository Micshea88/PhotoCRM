"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { blob } from "@/lib/blob"
import { files } from "./schema"

export const deleteFile = orgAction
  .metadata({ actionName: "files.delete" })
  .inputSchema(z.object({ id: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    const file = await ctx.db.query.files.findFirst({
      where: and(
        eq(files.id, parsedInput.id),
        eq(files.organizationId, ctx.activeOrg.id),
        isNull(files.deletedAt),
      ),
    })
    if (!file) {
      throw new ActionError("NOT_FOUND", "File not found")
    }
    // Soft-delete the row first; the cron purge (Phase 8) removes the blob from
    // storage after the retention window.
    await ctx.db
      .update(files)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(eq(files.id, file.id))
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "file.deleted",
      { resourceType: "file", resourceId: file.id, metadata: { url: file.url } },
    )
    revalidatePath("/files")
    return { id: file.id }
  })

// Hard-delete from blob storage. Used by the purge cron only.
export async function purgeBlob(url: string) {
  await blob.del(url)
}
