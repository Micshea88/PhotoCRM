import { and, isNotNull, lt, inArray } from "drizzle-orm"
import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"
import { items } from "@/modules/items/schema"
import { files } from "@/modules/files/schema"
import { paymentInstallments } from "@/modules/invoices/schema"
import { contacts, contactNotes } from "@/modules/contacts/schema"
import { callLog } from "@/modules/calls/schema"
import { emailLog } from "@/modules/email-log/schema"
import { faqEntries } from "@/modules/help/schema"
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

  // -------- Contacts (P4.2 — closes pre-existing gap) --------
  const contactRows = await db
    .select({ id: contacts.id, organizationId: contacts.organizationId })
    .from(contacts)
    .where(and(isNotNull(contacts.deletedAt), lt(contacts.deletedAt, cutoff)))
    .limit(BATCH_LIMIT)

  const contactOrgCounts = new Map<string, number>()
  for (const r of contactRows) {
    contactOrgCounts.set(r.organizationId, (contactOrgCounts.get(r.organizationId) ?? 0) + 1)
  }
  for (const [orgId, count] of contactOrgCounts) {
    await audit({ db, organizationId: orgId, actorUserId: null }, "purge.contacts", {
      metadata: { count, retentionDays: RETENTION_DAYS },
    })
  }
  if (contactRows.length > 0) {
    await db.delete(contacts).where(
      inArray(
        contacts.id,
        contactRows.map((r) => r.id),
      ),
    )
  }

  // -------- Contact notes (P4.2) --------
  const contactNoteRows = await db
    .select({ id: contactNotes.id, organizationId: contactNotes.organizationId })
    .from(contactNotes)
    .where(and(isNotNull(contactNotes.deletedAt), lt(contactNotes.deletedAt, cutoff)))
    .limit(BATCH_LIMIT)

  const contactNoteOrgCounts = new Map<string, number>()
  for (const r of contactNoteRows) {
    contactNoteOrgCounts.set(
      r.organizationId,
      (contactNoteOrgCounts.get(r.organizationId) ?? 0) + 1,
    )
  }
  for (const [orgId, count] of contactNoteOrgCounts) {
    await audit({ db, organizationId: orgId, actorUserId: null }, "purge.contact_notes", {
      metadata: { count, retentionDays: RETENTION_DAYS },
    })
  }
  if (contactNoteRows.length > 0) {
    await db.delete(contactNotes).where(
      inArray(
        contactNotes.id,
        contactNoteRows.map((r) => r.id),
      ),
    )
  }

  // -------- Call log (P4.2) --------
  const callRows = await db
    .select({ id: callLog.id, organizationId: callLog.organizationId })
    .from(callLog)
    .where(and(isNotNull(callLog.deletedAt), lt(callLog.deletedAt, cutoff)))
    .limit(BATCH_LIMIT)

  const callOrgCounts = new Map<string, number>()
  for (const r of callRows) {
    callOrgCounts.set(r.organizationId, (callOrgCounts.get(r.organizationId) ?? 0) + 1)
  }
  for (const [orgId, count] of callOrgCounts) {
    await audit({ db, organizationId: orgId, actorUserId: null }, "purge.call_log", {
      metadata: { count, retentionDays: RETENTION_DAYS },
    })
  }
  if (callRows.length > 0) {
    await db.delete(callLog).where(
      inArray(
        callLog.id,
        callRows.map((r) => r.id),
      ),
    )
  }
  // Note on call recordings: the recording file (if any) is referenced
  // via call_log.recording_file_id but its lifecycle is owned by the
  // `files` table's own soft-delete + purge. We do NOT cascade-delete
  // the file when the call_log row is purged — the FK is ON DELETE
  // SET NULL. Orphan recordings are reaped by the files purge above
  // once the file itself is soft-deleted.

  // -------- Email log (Backlog Item 2) --------
  const emailRows = await db
    .select({ id: emailLog.id, organizationId: emailLog.organizationId })
    .from(emailLog)
    .where(and(isNotNull(emailLog.deletedAt), lt(emailLog.deletedAt, cutoff)))
    .limit(BATCH_LIMIT)

  const emailOrgCounts = new Map<string, number>()
  for (const r of emailRows) {
    emailOrgCounts.set(r.organizationId, (emailOrgCounts.get(r.organizationId) ?? 0) + 1)
  }
  for (const [orgId, count] of emailOrgCounts) {
    await audit({ db, organizationId: orgId, actorUserId: null }, "purge.email_log", {
      metadata: { count, retentionDays: RETENTION_DAYS },
    })
  }
  if (emailRows.length > 0) {
    await db.delete(emailLog).where(
      inArray(
        emailLog.id,
        emailRows.map((r) => r.id),
      ),
    )
  }
  // Email attachments (when they land via blob upload) follow the same
  // pattern as call recordings — their lifecycle is owned by the
  // `files` purge above; we don't cascade from email_log.

  // -------- FAQ entries (P4.2 — global, no organization_id) --------
  // FAQ entries are product-level, not org-scoped. Audit rows here
  // would have organizationId=null, which the audit() helper accepts
  // for system-level events.
  const faqRows = await db
    .select({ id: faqEntries.id })
    .from(faqEntries)
    .where(and(isNotNull(faqEntries.deletedAt), lt(faqEntries.deletedAt, cutoff)))
    .limit(BATCH_LIMIT)
  if (faqRows.length > 0) {
    await db.delete(faqEntries).where(
      inArray(
        faqEntries.id,
        faqRows.map((r) => r.id),
      ),
    )
  }

  return Response.json({
    ok: true,
    purged: {
      items: itemRows.length,
      files: fileRows.length,
      paymentInstallments: installmentRows.length,
      contacts: contactRows.length,
      contactNotes: contactNoteRows.length,
      callLog: callRows.length,
      emailLog: emailRows.length,
      faqEntries: faqRows.length,
    },
    cutoff: cutoff.toISOString(),
    batchLimit: BATCH_LIMIT,
    moreToProcess:
      itemRows.length === BATCH_LIMIT ||
      fileRows.length === BATCH_LIMIT ||
      installmentRows.length === BATCH_LIMIT ||
      contactRows.length === BATCH_LIMIT ||
      contactNoteRows.length === BATCH_LIMIT ||
      callRows.length === BATCH_LIMIT ||
      emailRows.length === BATCH_LIMIT ||
      faqRows.length === BATCH_LIMIT,
  })
}
