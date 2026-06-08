import "server-only"
import { createId } from "@paralleldrive/cuid2"
import { and, eq, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { encrypt } from "@/lib/crypto"
import { telephonyConnections } from "@/modules/telephony/schema"
import type { RingCentralTokenResponse } from "./ringcentral-oauth"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Reactivate-or-insert helper for a RingCentral OAuth grant.
 *
 * The (org, user, provider) partial-unique index allows multiple
 * historical disconnected rows but enforces exactly one LIVE row. A
 * re-connect after a soft delete must therefore reactivate the
 * existing row (clear deletedAt/deletedBy) rather than insert a
 * duplicate — otherwise the partial index throws.
 *
 * Encrypts both tokens via src/lib/crypto.ts BEFORE the write.
 * Plaintext lives only in `tokens` (the argument) and the local
 * variables created here. It never reaches the DB, audit log, or
 * any return value.
 *
 * MUST run inside a transaction with `app.current_org` set — the
 * callback handler wires this via `runWithOrgContext`.
 */
export async function upsertRingCentralConnection(
  tx: DbHandle,
  args: {
    organizationId: string
    userId: string
    tokens: RingCentralTokenResponse
    now?: Date
  },
): Promise<{ id: string; reactivated: boolean }> {
  const now = args.now ?? new Date()
  const accessTokenExpiresAt = new Date(now.getTime() + args.tokens.expires_in * 1000)
  const refreshTokenExpiresAt = new Date(
    now.getTime() + args.tokens.refresh_token_expires_in * 1000,
  )
  const accessCipher = encrypt(args.tokens.access_token)
  const refreshCipher = encrypt(args.tokens.refresh_token)

  // Find ANY existing row (live or soft-deleted) for this (org,user,
  // provider). Reactivate it if found. Bypass the deleted_at filter
  // intentionally — the partial unique index covers only live rows.
  const [existingRow] = await tx
    .select({ id: telephonyConnections.id, deletedAt: telephonyConnections.deletedAt })
    .from(telephonyConnections)
    .where(
      and(
        eq(telephonyConnections.organizationId, args.organizationId),
        eq(telephonyConnections.userId, args.userId),
        eq(telephonyConnections.provider, "ringcentral"),
      ),
    )
    .orderBy(sql`${telephonyConnections.createdAt} DESC`)
    .limit(1)

  if (existingRow) {
    const wasDeleted = existingRow.deletedAt !== null
    await tx
      .update(telephonyConnections)
      .set({
        accessToken: accessCipher,
        refreshToken: refreshCipher,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        scope: args.tokens.scope,
        externalUserId: args.tokens.owner_id,
        // Clear the cached sipInfo on (re-)connect — the previous grant
        // may have been issued to a different RC extension or under a
        // different RC tenant; getDialerBootstrap will fetch fresh on
        // the next boot.
        sipInfoCached: null,
        sipInfoCachedAt: null,
        deletedAt: null,
        deletedBy: null,
        updatedAt: now,
        updatedBy: args.userId,
      })
      .where(eq(telephonyConnections.id, existingRow.id))
    return { id: existingRow.id, reactivated: wasDeleted }
  }

  const id = createId()
  await tx.insert(telephonyConnections).values({
    id,
    organizationId: args.organizationId,
    userId: args.userId,
    provider: "ringcentral",
    accessToken: accessCipher,
    refreshToken: refreshCipher,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    scope: args.tokens.scope,
    externalUserId: args.tokens.owner_id,
    // webhookSubscriptionId + validationToken intentionally null — the
    // webhook subscription is a separate push.
    createdAt: now,
    updatedAt: now,
    createdBy: args.userId,
    updatedBy: args.userId,
  })
  return { id, reactivated: false }
}
