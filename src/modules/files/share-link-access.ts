import "server-only"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { db } from "@/lib/db"
import { files } from "./schema"
import { fileShareLinks, fileShareLinkEvents } from "./share-link-schema"
import { isExpired, registerFailedAttempt } from "./share-link-core"
import { verifyPasscode } from "./share-link-crypto"

/**
 * Public (no-session) access layer for share links (Commit 3). Looked up by the
 * unguessable token; org scoping is implicit (the token is the secret). Used by
 * the external share-link landing / verify / download routes. No triggers
 * (memory #13).
 */
export interface ShareLinkWithFile {
  link: typeof fileShareLinks.$inferSelect
  file: typeof files.$inferSelect
}

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
  await db.insert(fileShareLinkEvents).values({
    id: createId(),
    organizationId,
    shareLinkId,
    eventType,
    recipientEmail: opts.recipientEmail ?? null,
    actorUserId: opts.actorUserId ?? null,
    metadata: opts.metadata ?? null,
  })
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
  if (verifyPasscode(passcode, link.passcodeHash)) {
    await db
      .update(fileShareLinks)
      .set({ failedPasscodeAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(fileShareLinks.id, link.id))
    return { status: "ok" }
  }
  const next = registerFailedAttempt(
    { failedAttempts: link.failedPasscodeAttempts, lastAttemptAt: link.updatedAt },
    now,
  )
  await db
    .update(fileShareLinks)
    .set({
      failedPasscodeAttempts: next.failedAttempts,
      lockedUntil: next.lockedUntil,
      updatedAt: now,
    })
    .where(and(eq(fileShareLinks.id, link.id)))
  if (next.lockedUntil) return { status: "locked", lockedUntil: next.lockedUntil }
  return { status: "wrong", attemptsRemaining: Math.max(0, 5 - next.failedAttempts) }
}
