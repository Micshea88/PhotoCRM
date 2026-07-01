import "server-only"
import { createId } from "@paralleldrive/cuid2"
import { and, eq, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { encrypt } from "@/lib/crypto"
import { env } from "@/lib/env"
import { emailConnections } from "./schema"
import { sourceValueForNylasProvider, type NylasGrantResponse } from "./nylas-oauth"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Reactivate-or-insert helper for a Nylas email grant.
 *
 * The (org, user, provider) partial-unique index allows multiple historical
 * disconnected rows but enforces exactly one LIVE row, so a re-connect after a
 * soft delete reactivates the existing row (clear deletedAt) rather than
 * inserting a duplicate.
 *
 * Encrypts the grant_id via src/lib/crypto.ts with NYLAS_ENCRYPTION_KEY BEFORE
 * the write. Plaintext lives only in the argument + local var; it never reaches
 * the DB, audit log, or any return value.
 *
 * MUST run inside a transaction with `app.current_org` set.
 */
export async function upsertNylasConnection(
  tx: DbHandle,
  args: {
    organizationId: string
    userId: string
    grant: NylasGrantResponse
    now?: Date
  },
): Promise<{ id: string; reactivated: boolean }> {
  const now = args.now ?? new Date()
  const grantCipher = encrypt(args.grant.grant_id, env.NYLAS_ENCRYPTION_KEY)
  const sourceValue = sourceValueForNylasProvider(args.grant.provider)
  const scopes = args.grant.scope ?? ""

  const [existingRow] = await tx
    .select({ id: emailConnections.id, deletedAt: emailConnections.deletedAt })
    .from(emailConnections)
    .where(
      and(
        eq(emailConnections.organizationId, args.organizationId),
        eq(emailConnections.userId, args.userId),
        eq(emailConnections.provider, args.grant.provider),
      ),
    )
    .orderBy(sql`${emailConnections.createdAt} DESC`)
    .limit(1)

  if (existingRow) {
    const wasDeleted = existingRow.deletedAt !== null
    await tx
      .update(emailConnections)
      .set({
        implementation: "nylas",
        sourceValue,
        email: args.grant.email,
        grantId: grantCipher,
        scopes,
        status: "connected",
        deletedAt: null,
        deletedBy: null,
        updatedAt: now,
        updatedBy: args.userId,
      })
      .where(eq(emailConnections.id, existingRow.id))
    return { id: existingRow.id, reactivated: wasDeleted }
  }

  const id = createId()
  await tx.insert(emailConnections).values({
    id,
    organizationId: args.organizationId,
    userId: args.userId,
    implementation: "nylas",
    provider: args.grant.provider,
    sourceValue,
    email: args.grant.email,
    grantId: grantCipher,
    scopes,
    status: "connected",
    createdAt: now,
    updatedAt: now,
    createdBy: args.userId,
    updatedBy: args.userId,
  })
  return { id, reactivated: false }
}
