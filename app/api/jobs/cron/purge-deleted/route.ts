import { and, isNotNull, lt } from "drizzle-orm"
import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { items } from "@/modules/items/schema"
import { files } from "@/modules/files/schema"
import { audit } from "@/modules/audit/audit"
import { blob } from "@/lib/blob"

const RETENTION_DAYS = 90

/**
 * Purges soft-deleted rows older than RETENTION_DAYS. This is the ONLY place
 * hard deletes happen (and the only place blob storage gets `del()`'d).
 *
 * Each purge writes an `audit_log` row per-org so the deletion is traceable.
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const purgedFiles = await db
    .delete(files)
    .where(and(isNotNull(files.deletedAt), lt(files.deletedAt, cutoff)))
    .returning()

  const purgedItems = await db
    .delete(items)
    .where(and(isNotNull(items.deletedAt), lt(items.deletedAt, cutoff)))
    .returning({ id: items.id, organizationId: items.organizationId })

  // Best-effort blob cleanup — failures here are logged but don't block the
  // DB purge (the orphan blobs can be reaped later by a separate sweep).
  for (const f of purgedFiles) {
    try {
      await blob.del(f.url)
    } catch (e) {
      console.error("[purge] blob delete failed for", f.url, e)
    }
  }

  // Audit one row per-org for each kind of resource purged.
  const orgItemCounts = new Map<string, number>()
  for (const it of purgedItems) {
    orgItemCounts.set(it.organizationId, (orgItemCounts.get(it.organizationId) ?? 0) + 1)
  }
  const orgFileCounts = new Map<string, number>()
  for (const f of purgedFiles) {
    orgFileCounts.set(f.organizationId, (orgFileCounts.get(f.organizationId) ?? 0) + 1)
  }
  for (const [orgId, count] of orgItemCounts) {
    await audit({ db, organizationId: orgId, actorUserId: null }, "purge.items", {
      metadata: { count, retentionDays: RETENTION_DAYS },
    })
  }
  for (const [orgId, count] of orgFileCounts) {
    await audit({ db, organizationId: orgId, actorUserId: null }, "purge.files", {
      metadata: { count, retentionDays: RETENTION_DAYS },
    })
  }

  return Response.json({
    ok: true,
    purged: { items: purgedItems.length, files: purgedFiles.length },
    cutoff: cutoff.toISOString(),
  })
}
