import "server-only"
import { eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { blob } from "@/lib/blob"
import { scanFile, type ScanVerdict } from "@/lib/cloudmersive"
import { log } from "@/lib/log"
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
    verdict = await scanFile(bytes, filename)
  } catch (err) {
    log.error({ err, fileId }, "files.scan: unexpected error, leaving pending")
    return "error"
  }
  log.info(
    { fileId, filename, verdict, totalResolveMs: Date.now() - resolveStart },
    "[SCAN-DIAG] files.scan resolve complete",
  )

  if (verdict === "clean") {
    await db
      .update(files)
      .set({ scanStatus: "clean", scannedAt: new Date() })
      .where(eq(files.id, fileId))
  } else if (verdict === "infected") {
    // Quarantine: remove the bytes from Blob, mark the row infected.
    try {
      await blob.del(url)
    } catch (err) {
      log.error({ err, fileId }, "files.scan: failed to delete infected blob")
    }
    await db
      .update(files)
      .set({ scanStatus: "infected", scannedAt: new Date() })
      .where(eq(files.id, fileId))
  }
  return verdict
}
