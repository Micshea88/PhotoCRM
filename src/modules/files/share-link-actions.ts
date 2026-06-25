"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { and, desc, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import type { Db } from "@/lib/db"
import { audit } from "@/modules/audit/audit"
import { sendEmail } from "@/lib/email"
import { organization } from "@/modules/auth/schema"
import { files } from "./schema"
import { fileShareLinks, fileShareLinkEvents } from "./share-link-schema"
import { generatePasscode, hashPasscode } from "./share-link-crypto"
import { resolveExpiration, SHARE_LINK_EXPIRATION_OPTIONS } from "./share-link-core"

/**
 * Share-link management actions (Commit 3, Phase D) — the server surface behind
 * the file detail page's "Sharing & Security" section: passcode
 * display/regenerate/resend/send-to-different-email, expiry reactivate/extend,
 * manual unlock, and the share log.
 *
 * Queries are inlined via ctx.db (not files/queries) for the same reason the
 * composer's actions are: this module is pulled into the section's client import
 * graph, and we keep @/lib/db out of any eager client import path.
 *
 * NOTE: no file-detail route exists in the app yet, so this section is not
 * user-reachable in Commit 3 — it is built + unit-tested in isolation and
 * mounted when the files-browse UI lands (same gating posture as
 * EmailThreadCard). The reactivate/extend AI-drafted notification ("Haiku
 * draft") is deferred to that wiring commit, since it prefills the on-page
 * composer which doesn't exist until the page does.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const expirationSchema = z.object({
  shareLinkId: z.string().min(1),
  expiration: z.enum(SHARE_LINK_EXPIRATION_OPTIONS),
  customDate: z.string().min(1).optional(),
})

/** Load an org-scoped share link by id (guards cross-org access). */
async function loadLink(db: Db, orgId: string, shareLinkId: string) {
  const [link] = await db
    .select()
    .from(fileShareLinks)
    .where(and(eq(fileShareLinks.id, shareLinkId), eq(fileShareLinks.organizationId, orgId)))
    .limit(1)
  if (!link) throw new ActionError("NOT_FOUND", "Share link not found")
  return link
}

async function fileName(db: Db, orgId: string, fileId: string): Promise<string> {
  const [f] = await db
    .select({ pathname: files.pathname })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.organizationId, orgId)))
    .limit(1)
  return f?.pathname ?? "your file"
}

async function studioContext(db: Db, orgId: string): Promise<string> {
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1)
  return org?.name ?? "your studio"
}

function passcodeEmailHtml(name: string, file: string, passcode: string, who: string): string {
  return `<p>Hi ${escapeHtml(name)},</p><p>The passcode for ${escapeHtml(
    file,
  )} is:</p><p style="font-size:20px;font-weight:bold">${escapeHtml(
    passcode,
  )}</p><p>— ${escapeHtml(who)}</p>`
}

/** The most recent recipient email recorded against a link (the original "sent"
 *  / "passcode_sent" event), used for resend. */
async function lastRecipient(db: Db, shareLinkId: string): Promise<string | null> {
  const [evt] = await db
    .select({ recipientEmail: fileShareLinkEvents.recipientEmail })
    .from(fileShareLinkEvents)
    .where(eq(fileShareLinkEvents.shareLinkId, shareLinkId))
    .orderBy(desc(fileShareLinkEvents.occurredAt))
    .limit(1)
  return evt?.recipientEmail ?? null
}

/** Read a file's share links + their event logs for the Sharing & Security UI. */
export const getFileSharing = orgAction
  .metadata({ actionName: "files.get_sharing" })
  .inputSchema(z.object({ fileId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const links = await ctx.db
      .select()
      .from(fileShareLinks)
      .where(
        and(
          eq(fileShareLinks.fileId, parsedInput.fileId),
          eq(fileShareLinks.organizationId, ctx.activeOrg.id),
        ),
      )
      .orderBy(desc(fileShareLinks.createdAt))
    const linkIds = links.map((l) => l.id)
    const events = linkIds.length
      ? await ctx.db
          .select()
          .from(fileShareLinkEvents)
          .where(eq(fileShareLinkEvents.organizationId, ctx.activeOrg.id))
          .orderBy(desc(fileShareLinkEvents.occurredAt))
      : []
    return {
      links: links.map((l) => ({
        id: l.id,
        token: l.token,
        passcodePlaintext: l.passcodePlaintext,
        expiresAt: l.expiresAt,
        active: l.active,
        revokedAt: l.revokedAt,
        lockedUntil: l.lockedUntil,
        failedPasscodeAttempts: l.failedPasscodeAttempts,
        createdAt: l.createdAt,
      })),
      events: events
        .filter((e) => linkIds.includes(e.shareLinkId))
        .map((e) => ({
          id: e.id,
          shareLinkId: e.shareLinkId,
          eventType: e.eventType,
          recipientEmail: e.recipientEmail,
          occurredAt: e.occurredAt,
        })),
    }
  })

/** Regenerate the passcode (same link/token). Returns the new plaintext. */
export const regenerateSharePasscode = orgAction
  .metadata({ actionName: "files.share_passcode_regenerate" })
  .inputSchema(z.object({ shareLinkId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const link = await loadLink(ctx.db, ctx.activeOrg.id, parsedInput.shareLinkId)
    const passcode = generatePasscode()
    await ctx.db
      .update(fileShareLinks)
      .set({
        passcodeHash: hashPasscode(passcode),
        passcodePlaintext: passcode,
        // A fresh passcode clears any standing lockout.
        failedPasscodeAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(fileShareLinks.id, link.id))
    await ctx.db.insert(fileShareLinkEvents).values({
      id: createId(),
      organizationId: ctx.activeOrg.id,
      shareLinkId: link.id,
      eventType: "passcode_regenerated",
      actorUserId: ctx.session.user.id,
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "files.share_passcode_regenerated",
      { resourceType: "file_share_link", resourceId: link.id },
    )
    revalidatePath("/files")
    return { passcode }
  })

/** Resend the passcode to the original recipient. */
export const resendSharePasscode = orgAction
  .metadata({ actionName: "files.share_passcode_resend" })
  .inputSchema(z.object({ shareLinkId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const link = await loadLink(ctx.db, ctx.activeOrg.id, parsedInput.shareLinkId)
    if (!link.passcodePlaintext) throw new ActionError("VALIDATION", "Link has no passcode")
    const to = await lastRecipient(ctx.db, link.id)
    if (!to)
      throw new ActionError("VALIDATION", "No recipient on record — use send to a different email")
    const name = await fileName(ctx.db, ctx.activeOrg.id, link.fileId)
    const studio = await studioContext(ctx.db, ctx.activeOrg.id)
    await sendEmail({
      to,
      subject: `Passcode for ${name}`,
      html: passcodeEmailHtml(
        to,
        name,
        link.passcodePlaintext,
        `${ctx.session.user.name}\n${studio}`,
      ),
    })
    await ctx.db.insert(fileShareLinkEvents).values({
      id: createId(),
      organizationId: ctx.activeOrg.id,
      shareLinkId: link.id,
      eventType: "passcode_resent",
      recipientEmail: to,
      actorUserId: ctx.session.user.id,
    })
    revalidatePath("/files")
    return { ok: true, to }
  })

/** Send the passcode to a different email address. */
export const sendPasscodeToRecipient = orgAction
  .metadata({ actionName: "files.share_passcode_alt" })
  .inputSchema(z.object({ shareLinkId: z.string().min(1), email: z.email() }))
  .action(async ({ parsedInput, ctx }) => {
    const link = await loadLink(ctx.db, ctx.activeOrg.id, parsedInput.shareLinkId)
    if (!link.passcodePlaintext) throw new ActionError("VALIDATION", "Link has no passcode")
    const name = await fileName(ctx.db, ctx.activeOrg.id, link.fileId)
    const studio = await studioContext(ctx.db, ctx.activeOrg.id)
    await sendEmail({
      to: parsedInput.email,
      subject: `Passcode for ${name}`,
      html: passcodeEmailHtml(
        parsedInput.email,
        name,
        link.passcodePlaintext,
        `${ctx.session.user.name}\n${studio}`,
      ),
    })
    await ctx.db.insert(fileShareLinkEvents).values({
      id: createId(),
      organizationId: ctx.activeOrg.id,
      shareLinkId: link.id,
      eventType: "passcode_alt_recipient",
      recipientEmail: parsedInput.email,
      actorUserId: ctx.session.user.id,
    })
    revalidatePath("/files")
    return { ok: true }
  })

/** Reactivate an expired/revoked link — same token + passcode, new expiry. */
export const reactivateShareLink = orgAction
  .metadata({ actionName: "files.share_reactivate" })
  .inputSchema(expirationSchema)
  .action(async ({ parsedInput, ctx }) => {
    const link = await loadLink(ctx.db, ctx.activeOrg.id, parsedInput.shareLinkId)
    const expiresAt = resolveExpiration(parsedInput.expiration, new Date(), parsedInput.customDate)
    await ctx.db
      .update(fileShareLinks)
      .set({
        active: true,
        revokedAt: null,
        revokedBy: null,
        expiresAt,
        failedPasscodeAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(fileShareLinks.id, link.id))
    await ctx.db.insert(fileShareLinkEvents).values({
      id: createId(),
      organizationId: ctx.activeOrg.id,
      shareLinkId: link.id,
      eventType: "reactivated",
      actorUserId: ctx.session.user.id,
      metadata: { expiration: parsedInput.expiration },
    })
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "files.share_reactivated",
      { resourceType: "file_share_link", resourceId: link.id },
    )
    revalidatePath("/files")
    return { ok: true, expiresAt }
  })

/** Extend an active link's expiry. */
export const extendShareLink = orgAction
  .metadata({ actionName: "files.share_extend" })
  .inputSchema(expirationSchema)
  .action(async ({ parsedInput, ctx }) => {
    const link = await loadLink(ctx.db, ctx.activeOrg.id, parsedInput.shareLinkId)
    const expiresAt = resolveExpiration(parsedInput.expiration, new Date(), parsedInput.customDate)
    await ctx.db
      .update(fileShareLinks)
      .set({ expiresAt, updatedAt: new Date() })
      .where(eq(fileShareLinks.id, link.id))
    await ctx.db.insert(fileShareLinkEvents).values({
      id: createId(),
      organizationId: ctx.activeOrg.id,
      shareLinkId: link.id,
      eventType: "extended",
      actorUserId: ctx.session.user.id,
      metadata: { expiration: parsedInput.expiration },
    })
    revalidatePath("/files")
    return { ok: true, expiresAt }
  })

/** Clear a passcode lockout immediately ("Unlock now"). */
export const manualUnlockShareLink = orgAction
  .metadata({ actionName: "files.share_unlock" })
  .inputSchema(z.object({ shareLinkId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const link = await loadLink(ctx.db, ctx.activeOrg.id, parsedInput.shareLinkId)
    await ctx.db
      .update(fileShareLinks)
      .set({ failedPasscodeAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(fileShareLinks.id, link.id))
    await ctx.db.insert(fileShareLinkEvents).values({
      id: createId(),
      organizationId: ctx.activeOrg.id,
      shareLinkId: link.id,
      eventType: "manual_unlock",
      actorUserId: ctx.session.user.id,
    })
    revalidatePath("/files")
    return { ok: true }
  })
