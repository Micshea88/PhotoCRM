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
