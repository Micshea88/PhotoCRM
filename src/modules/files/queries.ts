import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { files } from "./schema"

interface ListOptions {
  withDeleted?: boolean
}

export async function listFilesForOrg(orgId: string, opts: ListOptions = {}) {
  const where = opts.withDeleted
    ? eq(files.organizationId, orgId)
    : and(eq(files.organizationId, orgId), isNull(files.deletedAt))
  return db.select().from(files).where(where).orderBy(files.createdAt)
}

export async function getFileForOrg(orgId: string, id: string) {
  const [row] = await db
    .select()
    .from(files)
    .where(and(eq(files.organizationId, orgId), eq(files.id, id), isNull(files.deletedAt)))
    .limit(1)
  return row ?? null
}

/** Files eligible to attach to an email — clean (malware-passed) + not deleted
 *  (decision 25: "Choose existing" shows only scanStatus = "clean"). */
export async function listAttachableFilesForOrg(orgId: string) {
  return db
    .select({
      id: files.id,
      pathname: files.pathname,
      contentType: files.contentType,
      sizeBytes: files.sizeBytes,
      createdAt: files.createdAt,
    })
    .from(files)
    .where(
      and(eq(files.organizationId, orgId), eq(files.scanStatus, "clean"), isNull(files.deletedAt)),
    )
    .orderBy(files.createdAt)
}

/** Scan state for a single file — the composer polls this after "Upload new". */
export async function getFileScanState(orgId: string, id: string) {
  const [row] = await db
    .select({ id: files.id, scanStatus: files.scanStatus, sizeBytes: files.sizeBytes })
    .from(files)
    .where(and(eq(files.organizationId, orgId), eq(files.id, id), isNull(files.deletedAt)))
    .limit(1)
  return row ?? null
}

/** Resolve the file row created (async, in onUploadCompleted) for a blob url —
 *  the composer polls this right after client upload() resolves to learn the
 *  fileId + scan status. Null until the upload-completed callback has inserted. */
export async function getFileByUrl(orgId: string, url: string) {
  const [row] = await db
    .select({
      id: files.id,
      pathname: files.pathname,
      sizeBytes: files.sizeBytes,
      scanStatus: files.scanStatus,
    })
    .from(files)
    .where(and(eq(files.organizationId, orgId), eq(files.url, url), isNull(files.deletedAt)))
    .limit(1)
  return row ?? null
}
