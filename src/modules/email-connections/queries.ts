import "server-only"
import { createHash } from "node:crypto"
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

/**
 * SHA-256 hex digest of the plaintext grant_id.
 *
 * The canonical hash used in BOTH `upsertNylasConnection` (write path) and
 * `findConnectionByGrantIdAnyOrg` (lookup path) so there is ONE implementation.
 * The hash is a stable, non-reversible lookup key — not a secret — stored in
 * `email_connections.grant_id_hash`.
 */
export function grantIdHash(grantId: string): string {
  return createHash("sha256").update(grantId).digest("hex")
}

/**
 * Find the live email_connections row for a given plaintext grant_id, across
 * all orgs (cross-org: webhook has no session context — mirror the
 * `…AnyOrg` pattern in this file).
 *
 * Strategy:
 *   1. Hash lookup: WHERE grant_id_hash = hash AND deleted_at IS NULL — O(1)
 *      via the index. Fast path for all connections set up after Task 8.
 *   2. Decrypt-scan fallback: if no hash match, scan live rows whose
 *      grant_id_hash IS NULL (legacy pre-Task-8 connections), decrypt each,
 *      and find the one whose plaintext === grantId.  Opportunistically
 *      backfills the matched row's grant_id_hash so the fallback pool shrinks
 *      to zero as connections reconnect (no manual backfill step needed).
 *
 * Returns null when no match is found.
 */
export async function findConnectionByGrantIdAnyOrg(
  db: DbHandle,
  grantId: string,
): Promise<EmailConnection | null> {
  const hash = grantIdHash(grantId)

  // ── Fast path: hash index lookup ─────────────────────────────────────────
  const [byHash] = await db
    .select()
    .from(emailConnections)
    .where(and(eq(emailConnections.grantIdHash, hash), isNull(emailConnections.deletedAt)))
    .orderBy(desc(emailConnections.updatedAt))
    .limit(1)
  if (byHash) return byHash

  // ── Fallback: decrypt-scan over legacy un-hashed rows ────────────────────
  const unhashed = await db
    .select()
    .from(emailConnections)
    .where(and(isNull(emailConnections.grantIdHash), isNull(emailConnections.deletedAt)))

  for (const row of unhashed) {
    let plain: string
    try {
      plain = decrypt(row.grantId, env.NYLAS_ENCRYPTION_KEY)
    } catch {
      // Corrupted ciphertext — skip without throwing; shouldn't halt the scan.
      continue
    }
    if (plain === grantId) {
      // Opportunistic backfill: stamp the hash so future lookups use the index.
      await db
        .update(emailConnections)
        .set({ grantIdHash: hash, updatedAt: new Date() })
        .where(eq(emailConnections.id, row.id))
      return { ...row, grantIdHash: hash }
    }
  }

  return null
}

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

/**
 * All live expired connections for a specific user in the given org.
 *
 * Used by the app-shell reconnect banner (Task 19): runs on every page load
 * so it must be cheap. Indexed on (organizationId, userId, deletedAt) and
 * the query narrows to status="expired", so the result set is tiny in
 * practice (≤ active connections for the user, usually 1 or 0).
 *
 * User-scoped: only the mailbox owner's expired connections are returned.
 * Admins do NOT see other users' connections from this query.
 */
export async function listExpiredConnectionsForUser(
  db: DbHandle,
  orgId: string,
  userId: string,
): Promise<EmailConnection[]> {
  return db
    .select()
    .from(emailConnections)
    .where(
      and(
        eq(emailConnections.organizationId, orgId),
        eq(emailConnections.userId, userId),
        eq(emailConnections.status, "expired"),
        isNull(emailConnections.deletedAt),
      ),
    )
    .orderBy(desc(emailConnections.createdAt))
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
