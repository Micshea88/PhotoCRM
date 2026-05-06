import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/lib/db"
import { items } from "./schema"

interface ListOptions {
  /** Include soft-deleted rows. Default false. */
  withDeleted?: boolean
}

export async function listItemsForOrg(orgId: string, opts: ListOptions = {}) {
  const where = opts.withDeleted
    ? eq(items.organizationId, orgId)
    : and(eq(items.organizationId, orgId), isNull(items.deletedAt))
  return db.select().from(items).where(where).orderBy(items.createdAt)
}

export async function getItemForOrg(orgId: string, id: string, opts: ListOptions = {}) {
  const conditions = opts.withDeleted
    ? and(eq(items.organizationId, orgId), eq(items.id, id))
    : and(eq(items.organizationId, orgId), eq(items.id, id), isNull(items.deletedAt))
  const [row] = await db.select().from(items).where(conditions).limit(1)
  return row ?? null
}
