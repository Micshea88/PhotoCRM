"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"
import { createId } from "@paralleldrive/cuid2"
import { ActionError, orgAction } from "@/lib/safe-action"
import { audit } from "@/modules/audit/audit"
import { env } from "@/lib/env"
import { blob } from "@/lib/blob"
import { sendEmail } from "@/lib/email"
import { resolveSenderForUser, guessContentType } from "@/lib/email/provider"
import { organization } from "@/modules/auth/schema"
import { contacts } from "@/modules/contacts/schema"
import { touchContactActivity } from "@/modules/contacts/ai/cache-invalidation"
import { assertEventRefsInOrg } from "@/modules/projects/event-refs"
import { files } from "@/modules/files/schema"
import { fileShareLinks, fileShareLinkEvents } from "@/modules/files/share-link-schema"
import { orgPreferences } from "@/modules/org-preferences/schema"
import {
  generateShareToken,
  generatePasscode,
  hashPasscode,
} from "@/modules/files/share-link-crypto"
import {
  resolveExpiration,
  shareLinkPath,
  DEFAULT_SHARE_LINK_EXPIRATION,
} from "@/modules/files/share-link-core"
import { routeAttachments } from "./attachment-routing"
import { emailLog } from "./schema"
import { deleteEmailInput, logEmailInput, updateEmailInput } from "./types"

/**
 * Backlog Item 2 — manual "Log Email" entry point. Mirrors the
 * call_log.logCall shape: pre-flight contact check, insert, atomic
 * AI cache invalidation, audit, revalidate. Source is "manual";
 * provider rows (gmail/outlook/resend) come in through their own
 * ingest pipelines later.
 */
export const logEmail = orgAction
  .metadata({ actionName: "email_log.create_manual" })
  .inputSchema(logEmailInput)
  .action(async ({ parsedInput, ctx }) => {
    // Pre-flight: verify contact belongs to active org + isn't soft-
    // deleted. RLS would also block it but a pre-flight produces a
    // better error message.
    const [contact] = await ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, parsedInput.contactId),
          eq(contacts.organizationId, ctx.activeOrg.id),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1)
    if (!contact) {
      throw new ActionError("VALIDATION", "Contact not found in this organization.")
    }
    await assertEventRefsInOrg(ctx.db, ctx.activeOrg.id, {
      projectId: parsedInput.projectId,
      opportunityId: parsedInput.opportunityId,
    })

    const id = createId()
    await ctx.db.insert(emailLog).values({
      id,
      organizationId: ctx.activeOrg.id,
      contactId: parsedInput.contactId,
      userId: ctx.session.user.id,
      direction: parsedInput.direction,
      sentAt: new Date(parsedInput.sentAt),
      subject: parsedInput.subject ?? null,
      body: parsedInput.body ?? null,
      attachments: parsedInput.attachments ?? null,
      projectId: parsedInput.projectId ?? null,
      opportunityId: parsedInput.opportunityId ?? null,
      source: "manual",
      externalId: null,
      externalMetadata: null,
      createdBy: ctx.session.user.id,
      updatedBy: ctx.session.user.id,
    })
    await touchContactActivity(ctx.db, ctx.activeOrg.id, parsedInput.contactId)

    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "email_log.logged_manual",
      {
        resourceType: "email_log",
        resourceId: id,
        metadata: {
          contactId: parsedInput.contactId,
          direction: parsedInput.direction,
          hasAttachments: (parsedInput.attachments?.length ?? 0) > 0,
        },
      },
    )

    revalidatePath(`/contacts/${parsedInput.contactId}`)
    return { id }
  })

export const updateEmail = orgAction
  .metadata({ actionName: "email_log.update" })
  .inputSchema(updateEmailInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, ...rest } = parsedInput
    await assertEventRefsInOrg(ctx.db, ctx.activeOrg.id, {
      projectId: rest.projectId,
      opportunityId: rest.opportunityId,
    })
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: ctx.session.user.id,
    }
    if (rest.sentAt !== undefined) patch.sentAt = new Date(rest.sentAt)
    if (rest.direction !== undefined) patch.direction = rest.direction
    if (rest.subject !== undefined) patch.subject = rest.subject
    if (rest.body !== undefined) patch.body = rest.body
    if (rest.attachments !== undefined) patch.attachments = rest.attachments
    if (rest.projectId !== undefined) patch.projectId = rest.projectId
    if (rest.opportunityId !== undefined) patch.opportunityId = rest.opportunityId

    const result = await ctx.db
      .update(emailLog)
      .set(patch)
      .where(
        and(
          eq(emailLog.id, id),
          eq(emailLog.organizationId, ctx.activeOrg.id),
          isNull(emailLog.deletedAt),
        ),
      )
      .returning({ id: emailLog.id, contactId: emailLog.contactId })

    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Email not found")
    }
    if (result[0]?.contactId) {
      await touchContactActivity(ctx.db, ctx.activeOrg.id, result[0].contactId)
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "email_log.updated",
      { resourceType: "email_log", resourceId: id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id }
  })

export const deleteEmail = orgAction
  .metadata({ actionName: "email_log.delete" })
  .inputSchema(deleteEmailInput)
  .action(async ({ parsedInput, ctx }) => {
    const result = await ctx.db
      .update(emailLog)
      .set({ deletedAt: new Date(), deletedBy: ctx.session.user.id })
      .where(
        and(
          eq(emailLog.id, parsedInput.id),
          eq(emailLog.organizationId, ctx.activeOrg.id),
          isNull(emailLog.deletedAt),
        ),
      )
      .returning({ id: emailLog.id, contactId: emailLog.contactId })
    if (result.length === 0) {
      throw new ActionError("NOT_FOUND", "Email not found or already deleted")
    }
    if (result[0]?.contactId) {
      await touchContactActivity(ctx.db, ctx.activeOrg.id, result[0].contactId)
    }
    await audit(
      {
        db: ctx.db,
        organizationId: ctx.activeOrg.id,
        actorUserId: ctx.session.user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "email_log.deleted",
      { resourceType: "email_log", resourceId: parsedInput.id },
    )
    if (result[0]?.contactId) revalidatePath(`/contacts/${result[0].contactId}`)
    return { id: parsedInput.id }
  })

// ─── Create-an-email composer: send + log + share links (Commit 3) ──────────

const sendContactEmailInput = z.object({
  contactId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
  to: z.array(z.email()).min(1),
  cc: z.array(z.email()).default([]),
  bcc: z.array(z.email()).default([]),
  subject: z.string().min(1).max(998),
  body: z.string().max(50_000),
  attachments: z
    .array(
      z.object({
        fileId: z.string().min(1),
        protect: z.boolean().optional(),
        // Optional photographer-set passcode override (else auto-generated).
        password: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
        // Expiration option for send-as-link delivery (else org default).
        expiration: z.string().optional(),
        customExpiration: z.string().optional(),
      }),
    )
    .max(10)
    .default([]),
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const appBase = () => env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")

export const sendContactEmail = orgAction
  .metadata({ actionName: "email_log.send_contact" })
  .inputSchema(sendContactEmailInput)
  .action(async ({ parsedInput, ctx }) => {
    const orgId = ctx.activeOrg.id
    const userId = ctx.session.user.id

    // Primary contact (To) — the feed contact; gets the email logged + the
    // passcode email.
    const [primaryContact] = await ctx.db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        primaryEmail: contacts.primaryEmail,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, parsedInput.contactId),
          eq(contacts.organizationId, orgId),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1)
    if (!primaryContact)
      throw new ActionError("VALIDATION", "Contact not found in this organization.")
    await assertEventRefsInOrg(ctx.db, orgId, {
      projectId: parsedInput.projectId,
      opportunityId: parsedInput.opportunityId,
    })

    // Load + validate attachment files: must be in-org, not deleted, scan clean.
    const attachmentFiles = []
    for (const att of parsedInput.attachments) {
      const [file] = await ctx.db
        .select()
        .from(files)
        .where(
          and(eq(files.id, att.fileId), eq(files.organizationId, orgId), isNull(files.deletedAt)),
        )
        .limit(1)
      if (!file) throw new ActionError("VALIDATION", "A selected file was not found.")
      if (file.scanStatus !== "clean") {
        throw new ActionError("VALIDATION", "A selected file hasn't finished scanning yet.")
      }
      attachmentFiles.push({ att, file })
    }

    // Size routing: total > 25 MB → all send-as-link; else direct (decision 18/19).
    const bodyBytes = Buffer.byteLength(parsedInput.body, "utf8")
    const route = routeAttachments(
      attachmentFiles.map((a) => a.file.sizeBytes),
      bodyBytes,
    )

    // Org default expiration for link mode.
    const [pref] = await ctx.db
      .select({ exp: orgPreferences.defaultShareLinkExpiration })
      .from(orgPreferences)
      .where(eq(orgPreferences.organizationId, orgId))
      .limit(1)
    const defaultExpiration = pref?.exp ?? DEFAULT_SHARE_LINK_EXPIRATION
    const now = new Date()

    const directAttachments: { filename: string; content: string; contentType: string }[] = []
    const linkLines: { name: string; url: string; expiresAt: Date | null }[] = []
    const passcodeSends: { fileName: string; passcode: string }[] = []
    const loggedAttachments: {
      fileId: string
      name: string
      size: number
      deliveryMethod: "direct" | "link"
      shareLinkToken?: string
    }[] = []

    for (const { att, file } of attachmentFiles) {
      const fileName = file.pathname
      // Password-protected files MUST go through the share-link passcode page;
      // otherwise size routing decides.
      const deliveryMethod: "direct" | "link" =
        att.protect || route.mode === "link" ? "link" : "direct"
      // Set only for "link" delivery — the recipient's tokenized share URL,
      // surfaced as "Open share link" on the sender's activity feed.
      let shareLinkToken: string | undefined

      if (deliveryMethod === "direct") {
        const got = await blob.get(file.url)
        if (!got) throw new ActionError("VALIDATION", "A selected file could not be read.")
        const bytes = await new Response(got.stream).arrayBuffer()
        directAttachments.push({
          filename: fileName,
          content: Buffer.from(bytes).toString("base64"),
          contentType: guessContentType(fileName),
        })
      } else {
        const token = generateShareToken()
        shareLinkToken = token
        const passcode = att.protect ? (att.password ?? generatePasscode()) : null
        const expiresAt = resolveExpiration(
          att.expiration ?? defaultExpiration,
          now,
          att.customExpiration,
        )
        const linkId = createId()
        await ctx.db.insert(fileShareLinks).values({
          id: linkId,
          organizationId: orgId,
          fileId: file.id,
          token,
          passcodeHash: passcode ? hashPasscode(passcode) : null,
          passcodePlaintext: passcode,
          expiresAt,
          createdBy: userId,
        })
        await ctx.db.insert(fileShareLinkEvents).values({
          id: createId(),
          organizationId: orgId,
          shareLinkId: linkId,
          eventType: "sent",
          recipientEmail: primaryContact.primaryEmail,
          actorUserId: userId,
        })
        linkLines.push({ name: fileName, url: `${appBase()}${shareLinkPath(token)}`, expiresAt })
        if (passcode) passcodeSends.push({ fileName, passcode })
      }
      loggedAttachments.push({
        fileId: file.id,
        name: fileName,
        size: file.sizeBytes,
        deliveryMethod,
        ...(shareLinkToken ? { shareLinkToken } : {}),
      })
    }

    // Build HTML: body + share-link section + tracking pixel.
    const pixelId = createId()
    const linkSection =
      linkLines.length > 0
        ? `<hr /><p>Files shared with you:</p><ul>${linkLines
            .map(
              (l) =>
                `<li><a href="${l.url}">${escapeHtml(l.name)}</a>${
                  l.expiresAt
                    ? ` — link expires ${l.expiresAt.toLocaleDateString("en-US")}`
                    : " — link doesn't expire"
                }</li>`,
            )
            .join("")}</ul>`
        : ""
    const pixel = `<img src="${appBase()}/api/email/track/${pixelId}.png" width="1" height="1" alt="" style="display:none" />`
    const html = `<div>${escapeHtml(parsedInput.body).replace(/\n/g, "<br />")}</div>${linkSection}${pixel}`

    // Send AS the photographer through their connected mailbox (Nylas) when
    // live; otherwise the dressed Resend fallback ("Name — Business" <system>),
    // never a bare system address (Commit 4, answers #2/#3). Tracking pixel +
    // share links live in `html` and go out either way (answer #7).
    const [orgRow] = await ctx.db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)
    const { provider: emailProvider } = await resolveSenderForUser(ctx.db, {
      orgId,
      userId,
      photographerName: ctx.session.user.name,
      businessName: orgRow?.name ?? "your studio",
    })
    const sent = await emailProvider.send({
      to: parsedInput.to,
      cc: parsedInput.cc,
      bcc: parsedInput.bcc,
      subject: parsedInput.subject,
      html,
      attachments: directAttachments,
    })

    // Log: primary To contact (carries the threading Message-ID) + each KNOWN
    // CC contact (external_id null to respect the unique dedup index; never BCC).
    // `source` reflects the sending mailbox (gmail/outlook/imap or resend); the
    // Pathway threadId stays the key with any Nylas ids in externalMetadata.
    const attachmentsJson = loggedAttachments.length > 0 ? loggedAttachments : null
    await ctx.db.insert(emailLog).values({
      id: createId(),
      organizationId: orgId,
      contactId: primaryContact.id,
      userId,
      direction: "outbound",
      subject: parsedInput.subject,
      body: parsedInput.body,
      sentAt: now,
      source: sent.source,
      externalId: sent.externalId,
      threadId: sent.threadId,
      externalMetadata: sent.externalMetadata,
      trackingPixelId: pixelId,
      attachments: attachmentsJson,
      projectId: parsedInput.projectId ?? null,
      opportunityId: parsedInput.opportunityId ?? null,
      createdBy: userId,
      updatedBy: userId,
    })
    await touchContactActivity(ctx.db, orgId, primaryContact.id)

    const ccLogged = new Set<string>([primaryContact.id])
    for (const ccEmail of parsedInput.cc) {
      const lowered = ccEmail.trim().toLowerCase()
      const [ccContact] = await ctx.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, orgId),
            isNull(contacts.deletedAt),
            or(
              eq(sql`lower(${contacts.primaryEmail})`, lowered),
              eq(sql`lower(${contacts.secondaryEmail})`, lowered),
            ),
          ),
        )
        .orderBy(sql`${contacts.updatedAt} desc`)
        .limit(1)
      if (!ccContact || ccLogged.has(ccContact.id)) continue
      ccLogged.add(ccContact.id)
      await ctx.db.insert(emailLog).values({
        id: createId(),
        organizationId: orgId,
        contactId: ccContact.id,
        userId,
        direction: "outbound",
        subject: parsedInput.subject,
        body: parsedInput.body,
        sentAt: now,
        source: sent.source,
        externalId: null,
        threadId: sent.threadId,
        attachments: attachmentsJson,
        projectId: parsedInput.projectId ?? null,
        opportunityId: parsedInput.opportunityId ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      await touchContactActivity(ctx.db, orgId, ccContact.id)
    }

    // Passcode email(s) to the primary contact only (decision: never CC/BCC).
    // Sent sequentially right after the file email so it arrives second.
    if (passcodeSends.length > 0 && primaryContact.primaryEmail) {
      const [org] = await ctx.db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1)
      const studio = org?.name ?? "your studio"
      const photographer = ctx.session.user.name
      const firstName = primaryContact.firstName
      for (const p of passcodeSends) {
        await sendEmail({
          to: primaryContact.primaryEmail,
          subject: `Passcode for ${p.fileName}`,
          html: `<p>Hi ${escapeHtml(firstName)},</p><p>The passcode for ${escapeHtml(
            p.fileName,
          )} is:</p><p style="font-size:20px;font-weight:bold">${p.passcode}</p><p>— ${escapeHtml(
            photographer,
          )}<br />${escapeHtml(studio)}</p>`,
        })
      }
    }

    await audit(
      {
        db: ctx.db,
        organizationId: orgId,
        actorUserId: userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      "email_log.sent_contact",
      {
        resourceType: "email_log",
        resourceId: primaryContact.id,
        metadata: { messageId: sent.externalId },
      },
    )
    revalidatePath(`/contacts/${primaryContact.id}`)
    return { ok: true }
  })
