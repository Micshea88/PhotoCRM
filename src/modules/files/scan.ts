import "server-only"
import { eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { blob } from "@/lib/blob"
import { scanFile, type ScanVerdict } from "@/lib/cloudmersive"
import { log } from "@/lib/log"
import { withOrgContext } from "@/lib/org-context"
import { logScanStep } from "./scan-diagnostics"
import { files } from "./schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Resolve a just-uploaded file's scan state (Commit 3, decisions 15/24).
 * Fetches the private blob bytes, runs the Cloudmersive scan, and:
 *   - clean    → scanStatus "clean" + scannedAt (file becomes attachable)
 *   - infected → DELETE the blob, scanStatus "infected" + scannedAt
 *   - error    → leave "pending" (client shows "couldn't scan; try again")
 *
 * Runs in the Blob `onUploadCompleted` server callback (async from the client,
 * which polls scanStatus). Never throws — a scan failure must not 500 the
 * upload webhook; it degrades to "pending".
 */
export async function scanAndResolveFile(
  db: DbHandle,
  fileId: string,
  url: string,
  filename: string,
  orgId?: string,
): Promise<ScanVerdict> {
  // [SCAN-DIAG] (2026-06-26) breaks the resolve time into blob-download vs.
  // scan-API so we can attribute slowness. Grep Vercel logs for "[SCAN-DIAG]".
  const resolveStart = Date.now()
  let verdict: ScanVerdict = "error"
  try {
    const downloadStart = Date.now()
    const result = await blob.get(url)
    if (!result) {
      log.error({ fileId }, "files.scan: blob not found, leaving pending")
      return "error"
    }
    const bytes = await new Response(result.stream).arrayBuffer()
    const downloadMs = Date.now() - downloadStart
    log.info(
      { fileId, filename, sizeBytes: bytes.byteLength, downloadMs },
      "[SCAN-DIAG] files.scan blob download complete",
    )
    verdict = await scanFile(bytes, filename, orgId)
  } catch (err) {
    log.error({ err, fileId }, "files.scan: unexpected error, leaving pending")
    return "error"
  }
  log.info(
    { fileId, filename, verdict, totalResolveMs: Date.now() - resolveStart },
    "[SCAN-DIAG] files.scan resolve complete",
  )

  if (verdict === "infected") {
    // Quarantine: remove the bytes from Blob before marking the row.
    try {
      await blob.del(url)
    } catch (err) {
      log.error({ err, fileId }, "files.scan: failed to delete infected blob")
    }
  }

  if (verdict === "clean" || verdict === "infected") {
    // `files` now has FORCE RLS (0061). This sessionless upload callback must
    // write org-scoped, not on the BYPASSRLS owner — resolve the org from the
    // upload's verified token (`orgId`) and run under app_authenticated + GUC.
    // The update is also PK-scoped (files.id), so it can never touch another org.
    const applyStatus = (h: DbHandle) =>
      h
        .update(files)
        .set({ scanStatus: verdict, scannedAt: new Date() })
        .where(eq(files.id, fileId))
    if (orgId) {
      await withOrgContext((tx) => applyStatus(tx), { orgId, role: "owner", userId: "" })
    } else {
      // No org on the payload should not happen (files always carry an org);
      // fall back to the passed handle so a scan result is never silently lost.
      await applyStatus(db)
    }
  }
  if (verdict !== "error") {
    await logScanStep("scan_status_updated", { fileId, filename, status: verdict, orgId })
  }
  return verdict
}
