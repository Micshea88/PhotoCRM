/**
 * Task 10b — Notification email sender.
 *
 * Looks up the recipient's email address from the `user` table and delivers
 * a minimal transactional notification email via `sendEmail`.
 *
 * Returns `true` if an email was dispatched, `false` if the user has no
 * email address on record (no-op; caller decides whether to log/retry).
 */
import "server-only"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { user } from "@/modules/auth/schema"
import { sendEmail } from "@/lib/email"

export async function sendNotificationEmail(
  recipientUserId: string,
  title: string,
  body: string | null,
  linkPath?: string | null,
): Promise<boolean> {
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, recipientUserId))
    .limit(1)

  if (!row?.email) return false

  const appBase = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")
  const linkHtml = linkPath ? `<p><a href="${appBase}${linkPath}">View in Pathway</a></p>` : ""

  const html = [
    `<p><strong>${escapeHtml(title)}</strong></p>`,
    body ? `<p>${escapeHtml(body)}</p>` : null,
    linkHtml || null,
  ]
    .filter(Boolean)
    .join("\n")

  await sendEmail({ to: row.email, subject: title, html })
  return true
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
