import "server-only"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { decrypt } from "@/lib/crypto"
import { env } from "@/lib/env"
import { emailConnections, type EmailConnection } from "./schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Read helpers for per-photographer email connections.
 *
 * All reads run under RLS (org-scoped). The grant_id is returned ENCRYPTED on
 * the row; decrypt only at point of use via `decryptGrantId` (immediately
 * before a Nylas API call), never earlier and never into logs/audit.
 */

/** The single live connection for a user, or null. */
export async function getLiveConnectionForUser(
  db: DbHandle,
  orgId: string,
  userId: string,
): Promise<EmailConnection | null> {
  const [row] = await db
    .select()
    .from(emailConnections)
    .where(
      and(
        eq(emailConnections.organizationId, orgId),
        eq(emailConnections.userId, userId),
        isNull(emailConnections.deletedAt),
      ),
    )
    .orderBy(desc(emailConnections.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * The live connection whose connected mailbox == `email` (inbound routing: which
 * photographer's grant received this webhook). Case-insensitive.
 */
export async function findConnectionByEmail(
  db: DbHandle,
  orgId: string,
  email: string,
): Promise<EmailConnection | null> {
  const lowered = email.trim().toLowerCase()
  if (!lowered) return null
  const [row] = await db
    .select()
    .from(emailConnections)
    .where(
      and(
        eq(emailConnections.organizationId, orgId),
        eq(emailConnections.email, lowered),
        isNull(emailConnections.deletedAt),
      ),
    )
    .orderBy(desc(emailConnections.createdAt))
    .limit(1)
  return row ?? null
}

/**
 * The live connection whose mailbox is in `addresses` (inbound Nylas routing —
 * which photographer's grant received this). Cross-org / no RLS scope, since the
 * webhook has no session context (single-tenant V1 → effectively one org); the
 * base db role reads across orgs, matching the sender lookup in email-log
 * inbound. Returns the first match by most-recent.
 */
export async function findLiveConnectionByAddressAnyOrg(
  db: DbHandle,
  addresses: string[],
): Promise<EmailConnection | null> {
  const lowered = addresses.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0)
  if (lowered.length === 0) return null
  const [row] = await db
    .select()
    .from(emailConnections)
    .where(and(inArray(emailConnections.email, lowered), isNull(emailConnections.deletedAt)))
    .orderBy(desc(emailConnections.updatedAt))
    .limit(1)
  return row ?? null
}

/** Decrypt a stored grant_id at point of use. */
export function decryptGrantId(connection: EmailConnection): string {
  return decrypt(connection.grantId, env.NYLAS_ENCRYPTION_KEY)
}

/** A connection is usable for sending only when it is live AND not expired.
 *  An expired grant is treated the same as never-connected (dressed fallback). */
export function isSendable(connection: EmailConnection | null): connection is EmailConnection {
  return !!connection && connection.status === "connected"
}
