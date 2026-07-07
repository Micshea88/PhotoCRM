import "server-only"
import { and, eq, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import { createId } from "@paralleldrive/cuid2"
import { db } from "@/lib/db"
import type * as schema from "@/db/schema"
import { files } from "./schema"
import { fileShareLinks, fileShareLinkEvents } from "./share-link-schema"
import { isExpired, registerFailedAttempt } from "./share-link-core"
import { verifyPasscode } from "./share-link-crypto"

type DbHandle = NodePgDatabase<typeof schema>

/**
 * Public (no-session) access layer for share links (Commit 3). Used by the
 * external share-link landing / verify / download routes, which have no session.
 *
 * RLS model (multi-tenant isolation, 2026-07): file_share_links / files /
 * file_share_link_events now have FORCE org-isolation RLS. A public route knows
 * only the token, not the org — so `getShareLinkByToken` resolves the org via a
 * single owner-connection lookup on the unguessable 128-bit token (see its doc),
 * and EVERY subsequent write runs org-scoped via `runScoped` below. No triggers
 * (memory #13).
 */

/**
 * Run `fn` inside a transaction scoped to `orgId`: drop into the NOBYPASSRLS
 * `app_authenticated` role and set `app.current_org`, so the org-isolation RLS
 * policies on file_share_links / file_share_link_events enforce for the writes
 * inside. Mirrors the server-to-server pattern in email-log/inbound.ts and
 * rc-sync/runner.ts (sessionless callers that must still respect RLS).
 */
async function runScoped<T>(orgId: string, fn: (tx: DbHandle) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
    await tx.execute(sql`SELECT set_config('app.current_org', ${orgId}, true)`)
    return fn(tx)
  })
}

export interface ShareLinkWithFile {
  link: typeof fileShareLinks.$inferSelect
  file: typeof files.$inferSelect
}

/**
 * Resolve a share link + its file from the public token.
 *
 * OWNER-SCOPED READ (deliberate, documented): this is the ONE read in the public
 * path that legitimately has no prior org context — the org is a property of the
 * row we're fetching, so we cannot set app.current_org before the lookup. We run
 * it on the bare `db` connection (the prod pool role is BYPASSRLS, so it reads
 * across orgs) keyed ONLY on the unguessable 128-bit CUID2 token, which is itself
 * the access secret. This mirrors the blessed cross-org owner read in
 * email-log/inbound.ts (`findContactAnyOrg`). Callers extract `link.organizationId`
 * and MUST run every follow-on read/write org-scoped (see `runScoped`). A tampered
 * or foreign token simply matches no row (unique token) → returns null; it can
 * never surface another org's file, because the join is by the link's own fileId
 * and both rows share the same organization_id.
 *
 * NOTE (dev parity): under the dev connection role (pathway_app, NOBYPASSRLS) this
 * owner read is subject to RLS and returns null without a GUC — same accepted
 * asymmetry as findContactAnyOrg. Production (BYPASSRLS owner) resolves the row.
 */
export async function getShareLinkByToken(token: string): Promise<ShareLinkWithFile | null> {
  const [row] = await db
    .select({ link: fileShareLinks, file: files })
    .from(fileShareLinks)
    .innerJoin(files, eq(files.id, fileShareLinks.fileId))
    .where(eq(fileShareLinks.token, token))
    .limit(1)
  return row ?? null
}

export type LinkAvailability = "ok" | "not_found" | "revoked" | "expired"

export function linkAvailability(
  link: typeof fileShareLinks.$inferSelect | null,
  now: Date,
): LinkAvailability {
  if (!link) return "not_found"
  if (!link.active || link.revokedAt) return "revoked"
  if (isExpired(link.expiresAt, now)) return "expired"
  return "ok"
}

export async function logShareEvent(
  shareLinkId: string,
  organizationId: string,
  eventType: string,
  opts: {
    recipientEmail?: string | null
    actorUserId?: string | null
    metadata?: Record<string, unknown>
  } = {},
): Promise<void> {
  // Org-scoped write — the public path has no session, so we set app.current_org
  // = the link's org (resolved via the token) so the RLS WITH CHECK is satisfied.
  await runScoped(organizationId, (tx) =>
    tx.insert(fileShareLinkEvents).values({
      id: createId(),
      organizationId,
      shareLinkId,
      eventType,
      recipientEmail: opts.recipientEmail ?? null,
      actorUserId: opts.actorUserId ?? null,
      metadata: opts.metadata ?? null,
    }),
  )
}

export type VerifyResult =
  | { status: "ok" }
  | { status: "wrong"; attemptsRemaining: number }
  | { status: "locked"; lockedUntil: Date }

/**
 * Verify a passcode attempt against a link, applying the 5/15min → 30min
 * lockout. Updates failed_passcode_attempts / locked_until (uses updatedAt as
 * the window anchor). Resets the counter on success.
 */
export async function verifyShareLinkPasscode(
  link: typeof fileShareLinks.$inferSelect,
  passcode: string,
  now: Date,
): Promise<VerifyResult> {
  const existingLock = link.lockedUntil
  if (existingLock && existingLock.getTime() > now.getTime()) {
    return { status: "locked", lockedUntil: existingLock }
  }
  // Org-scoped updates — the public path has no session, so we set
  // app.current_org = the link's own org so the RLS USING/WITH CHECK is satisfied.
  if (verifyPasscode(passcode, link.passcodeHash)) {
    await runScoped(link.organizationId, (tx) =>
      tx
        .update(fileShareLinks)
        .set({ failedPasscodeAttempts: 0, lockedUntil: null, updatedAt: now })
        .where(eq(fileShareLinks.id, link.id)),
    )
    return { status: "ok" }
  }
  const next = registerFailedAttempt(
    { failedAttempts: link.failedPasscodeAttempts, lastAttemptAt: link.updatedAt },
    now,
  )
  await runScoped(link.organizationId, (tx) =>
    tx
      .update(fileShareLinks)
      .set({
        failedPasscodeAttempts: next.failedAttempts,
        lockedUntil: next.lockedUntil,
        updatedAt: now,
      })
      .where(and(eq(fileShareLinks.id, link.id))),
  )
  if (next.lockedUntil) return { status: "locked", lockedUntil: next.lockedUntil }
  return { status: "wrong", attemptsRemaining: Math.max(0, 5 - next.failedAttempts) }
}
