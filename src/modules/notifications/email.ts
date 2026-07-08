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
import { log } from "@/lib/log"
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

  let linkHtml = ""
  if (linkPath) {
    if (isSafeLinkPath(linkPath)) {
      linkHtml = `<p><a href="${appBase}${escapeHtml(linkPath)}">View in Pathway</a></p>`
    } else {
      log.warn({ linkPath }, "sendNotificationEmail: unsafe linkPath dropped")
    }
  }

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

/**
 * Returns true only for safe internal relative paths:
 *   - must start with exactly one "/" (not protocol-relative "//")
 *   - must not contain a URL scheme (e.g. "javascript:", "data:")
 */
function isSafeLinkPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false
  // Reject anything that looks like scheme:// or scheme: anywhere in the path
  if (/[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(path)) return false
  return true
}
