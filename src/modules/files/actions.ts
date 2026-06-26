"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { log } from "@/lib/log"
import { logScanStep } from "./scan-diagnostics"
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
      "files.deleted",
      { resourceType: "file", resourceId: file.id, metadata: { url: file.url } },
    )
    revalidatePath("/files")
    return { id: file.id }
  })

/** Composer "Choose existing" — clean, attachable files for the active org.
 *  Queries inlined via ctx.db (rather than importing files/queries) so this
 *  action module — pulled into the client composer's import graph — does not
 *  eagerly import @/lib/db (whose top-level pool init accesses server env). */
export const listAttachableFiles = orgAction
  .metadata({ actionName: "files.list_attachable" })
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: files.id,
        pathname: files.pathname,
        contentType: files.contentType,
        sizeBytes: files.sizeBytes,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(
        and(
          eq(files.organizationId, ctx.activeOrg.id),
          eq(files.scanStatus, "clean"),
          isNull(files.deletedAt),
        ),
      )
      .orderBy(files.createdAt)
    return { files: rows }
  })

/** Composer "Upload new" — poll a file's scan state until clean/infected. */
export const pollFileScanState = orgAction
  .metadata({ actionName: "files.poll_scan_state" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    await logScanStep("poll_received", { fileId: parsedInput.id, orgId: ctx.activeOrg.id })
    const [row] = await ctx.db
      .select({ id: files.id, scanStatus: files.scanStatus, sizeBytes: files.sizeBytes })
      .from(files)
      .where(
        and(
          eq(files.organizationId, ctx.activeOrg.id),
          eq(files.id, parsedInput.id),
          isNull(files.deletedAt),
        ),
      )
      .limit(1)
    if (!row) throw new ActionError("NOT_FOUND", "File not found")
    // [SCAN-DIAG] (2026-06-26) each client poll lands here — the gap between
    // consecutive lines reveals the effective polling interval, and the count of
    // "pending" lines × interval ≈ the user-perceived wait. Grep "[SCAN-DIAG]".
    log.info(
      { fileId: row.id, scanStatus: row.scanStatus, ts: Date.now() },
      "[SCAN-DIAG] pollFileScanState check",
    )
    await logScanStep("poll_returned_status", {
      fileId: row.id,
      status: row.scanStatus,
      orgId: ctx.activeOrg.id,
    })
    return row
  })

/** Composer "Upload new" — resolve the async-created file row by blob url
 *  (returns null until onUploadCompleted has inserted it). */
export const resolveUploadedFile = orgAction
  .metadata({ actionName: "files.resolve_uploaded" })
  .inputSchema(z.object({ url: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const [file] = await ctx.db
      .select({
        id: files.id,
        pathname: files.pathname,
        sizeBytes: files.sizeBytes,
        scanStatus: files.scanStatus,
      })
      .from(files)
      .where(
        and(
          eq(files.organizationId, ctx.activeOrg.id),
          eq(files.url, parsedInput.url),
          isNull(files.deletedAt),
        ),
      )
      .limit(1)
    return { file: file ?? null }
  })
