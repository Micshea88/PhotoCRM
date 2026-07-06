import "server-only"
import { and, desc, isNull, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "@/db/schema"
import { emailLog } from "./schema"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Cross-org resolver: find the most-recent `email_log` row whose
 * `external_metadata->>'resendEmailId'` matches the given Resend email_id.
 *
 * Uses a PLAIN db.select() with NO org GUC set. In production the base pool
 * role (`neondb_owner`) has BYPASSRLS, so FORCE ROW LEVEL SECURITY does not
 * apply and the query returns rows across all organisations. In dev
 * (`pathway_app`, NOBYPASSRLS) the base pool IS subject to FORCE RLS; callers
 * that need the result in dev (e.g. the webhook handler) must ensure the GUC
 * is set externally — or accept that dev integration tests require an explicit
 * org context to see rows.
 *
 * Mirrors the pattern of `findLiveConnectionByAddressAnyOrg` in
 * `src/modules/email-connections/queries.ts`.
 */
export async function findEmailLogByResendEmailIdAnyOrg(
  db: DbHandle,
  resendEmailId: string,
): Promise<{ id: string; organizationId: string } | null> {
  const [row] = await db
    .select({ id: emailLog.id, organizationId: emailLog.organizationId })
    .from(emailLog)
    .where(
      and(
        sql`${emailLog.externalMetadata}->>'resendEmailId' = ${resendEmailId}`,
        isNull(emailLog.deletedAt),
      ),
    )
    .orderBy(desc(emailLog.sentAt))
    .limit(1)
  return row ?? null
}

/**
 * Cross-org resolver: find the most-recent `email_log` row whose
 * `external_metadata->>'nylasMessageId'` matches the given Nylas message id.
 *
 * Mirrors `findEmailLogByResendEmailIdAnyOrg` exactly — plain `db.select()`,
 * cross-org, base pool role bypasses RLS in production. In dev the GUC must
 * be set externally for the query to return rows (see the Resend counterpart
 * for the full RLS-bypass note).
 */
export async function findEmailLogByNylasMessageIdAnyOrg(
  db: DbHandle,
  nylasMessageId: string,
): Promise<{ id: string; organizationId: string } | null> {
  const [row] = await db
    .select({ id: emailLog.id, organizationId: emailLog.organizationId })
    .from(emailLog)
    .where(
      and(
        sql`${emailLog.externalMetadata}->>'nylasMessageId' = ${nylasMessageId}`,
        isNull(emailLog.deletedAt),
      ),
    )
    .orderBy(desc(emailLog.sentAt))
    .limit(1)
  return row ?? null
}
