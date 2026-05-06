import "server-only"
import { createId } from "@paralleldrive/cuid2"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { auditLog } from "./schema"

/** Loose db type that accepts both pool-bound and client-bound (transactional) drizzle handles. */
type AuditDb = NodePgDatabase<typeof schema>

export interface AuditContext {
  db: AuditDb
  organizationId: string
  actorUserId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface AuditPayload {
  resourceType?: string
  resourceId?: string
  metadata?: Record<string, unknown>
}

export async function audit(ctx: AuditContext, action: string, payload: AuditPayload = {}) {
  await ctx.db.insert(auditLog).values({
    id: createId(),
    organizationId: ctx.organizationId,
    actorUserId: ctx.actorUserId,
    action,
    resourceType: payload.resourceType,
    resourceId: payload.resourceId,
    metadata: payload.metadata,
    ipAddress: ctx.ipAddress ?? null,
    userAgent: ctx.userAgent ?? null,
  })
}
