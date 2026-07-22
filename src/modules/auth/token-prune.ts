import "server-only"
import { lt, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { verification } from "@/modules/auth/schema"

/**
 * Delete Better Auth `verification` rows past their expiry (chiefly the
 * password-reset tokens, stored as `reset-password:<token>` with a 1h expiry —
 * email verification uses stateless JWTs and is not in this table). Better Auth
 * never prunes these, so they accumulate; deleting expired rows bounds the table
 * AND shrinks the window an expired token lingers in the DB at rest.
 *
 * Runs on the base connection (BA tables are RLS-excluded, no org). Returns the
 * number of rows removed.
 */
export async function pruneExpiredVerifications(
  db: NodePgDatabase<typeof schema>,
): Promise<number> {
  const rows = await db
    .delete(verification)
    .where(lt(verification.expiresAt, sql`now()`))
    .returning({ id: verification.id })
  return rows.length
}
