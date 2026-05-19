import { and, isNotNull, lt, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { items } from "@/modules/items/schema"
import { files } from "@/modules/files/schema"
import { paymentInstallments } from "@/modules/invoices/schema"
import { audit } from "@/modules/audit/audit"
import { blob } from "@/lib/blob"
import { log } from "@/lib/log"

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90)
const BATCH_LIMIT = Number(process.env.PURGE_BATCH_LIMIT ?? 1000)
const PURGE_ENABLED = (process.env.PURGE_ENABLED ?? "true") !== "false"

/**
 * Hard-deletes soft-deleted rows older than RETENTION_DAYS. This is the ONLY
 * place hard deletes happen, and the only place blob storage gets `del()`'d.
 *
 * Safety properties:
 *   - PURGE_ENABLED env can be set to "false" as a kill-switch without a deploy.
 *   - Each invocation processes at most BATCH_LIMIT rows per resource type;
 *     larger backlogs are drained over multiple cron runs.
 *   - Audit row is written BEFORE the DB delete so even a crash mid-run leaves
 *     a forensic trail.
 *   - Blob deletes are best-effort and run after the DB delete; orphan blobs
 *     can be reaped by a separate sweep if any fail.
 */
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  if (!PURGE_ENABLED) {
    log.warn("[purge] PURGE_ENABLED=false — skipping")
    return Response.json({ ok: true, skipped: true, reason: "PURGE_ENABLED=false" })
  }
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  // -------- Items --------
  const itemRows = await db
    .select({ id: items.id, organizationId: items.organizationId })
    .from(items)
    .where(and(isNotNull(items.deletedAt), lt(items.deletedAt, cutoff)))
    .limit(BATCH_LIMIT)

  const itemOrgCounts = new Map<string, number>()
  for (const r of itemRows) {
    itemOrgCounts.set(r.organizationId, (itemOrgCounts.get(r.organizationId) ?? 0) + 1)
  }
  for (const [orgId, count] of itemOrgCounts) {
    await audit({ db, organizationId: orgId, actorUserId: null }, "purge.items", {
      metadata: { count, retentionDays: RETENTION_DAYS },
    })
  }
  if (itemRows.length > 0) {
    await db.delete(items).where(
      inArray(
        items.id,
        itemRows.map((r) => r.id),
      ),
    )
  }

  // -------- Files --------
  const fileRows = await db
    .select({
      id: files.id,
      url: files.url,
      organizationId: files.organizationId,
    })
    .from(files)
    .where(and(isNotNull(files.deletedAt), lt(files.deletedAt, cutoff)))
    .limit(BATCH_LIMIT)

  const fileOrgCounts = new Map<string, number>()
  for (const r of fileRows) {
    fileOrgCounts.set(r.organizationId, (fileOrgCounts.get(r.organizationId) ?? 0) + 1)
  }
  for (const [orgId, count] of fileOrgCounts) {
    await audit({ db, organizationId: orgId, actorUserId: null }, "purge.files", {
      metadata: { count, retentionDays: RETENTION_DAYS },
    })
  }
  if (fileRows.length > 0) {
    await db.delete(files).where(
      inArray(
        files.id,
        fileRows.map((r) => r.id),
      ),
    )
  }

  // Best-effort blob cleanup AFTER the DB delete commits. A failure here leaves
  // an orphan blob (cheap, reapable) rather than an orphan DB row pointing at a
  // deleted blob (which would 404 on next read).
  for (const f of fileRows) {
    try {
      await blob.del(f.url)
    } catch (e) {
      log.error({ err: e, url: f.url }, "[purge] blob delete failed")
    }
  }

  // -------- Payment installments --------
  const installmentRows = await db
    .select({
      id: paymentInstallments.id,
      organizationId: paymentInstallments.organizationId,
    })
    .from(paymentInstallments)
    .where(and(isNotNull(paymentInstallments.deletedAt), lt(paymentInstallments.deletedAt, cutoff)))
    .limit(BATCH_LIMIT)

  const installmentOrgCounts = new Map<string, number>()
  for (const r of installmentRows) {
    installmentOrgCounts.set(
      r.organizationId,
      (installmentOrgCounts.get(r.organizationId) ?? 0) + 1,
    )
  }
  for (const [orgId, count] of installmentOrgCounts) {
    await audit({ db, organizationId: orgId, actorUserId: null }, "purge.payment_installments", {
      metadata: { count, retentionDays: RETENTION_DAYS },
    })
  }
  if (installmentRows.length > 0) {
    await db.delete(paymentInstallments).where(
      inArray(
        paymentInstallments.id,
        installmentRows.map((r) => r.id),
      ),
    )
  }

  return Response.json({
    ok: true,
    purged: {
      items: itemRows.length,
      files: fileRows.length,
      paymentInstallments: installmentRows.length,
    },
    cutoff: cutoff.toISOString(),
    batchLimit: BATCH_LIMIT,
    moreToProcess:
      itemRows.length === BATCH_LIMIT ||
      fileRows.length === BATCH_LIMIT ||
      installmentRows.length === BATCH_LIMIT,
  })
}
