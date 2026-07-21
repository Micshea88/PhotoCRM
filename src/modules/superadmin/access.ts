import "server-only"
import { env } from "@/lib/env"
import { ActionError } from "@/lib/safe-action"

/**
 * Pathway-staff superadmin gate (Piece C). Membership is an env allowlist
 * (`PATHWAY_SUPERADMIN_EMAILS`, comma-separated) — set once, with NO in-app path
 * to grant it. This is the single source of truth for who may use the
 * cross-tenant account-recovery console; both the page and every recovery action
 * check it.
 */
function superadminEmails(): string[] {
  return (env.PATHWAY_SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isPathwaySuperadmin(email: string | null | undefined): boolean {
  if (!email) return false
  return superadminEmails().includes(email.toLowerCase())
}

/** Throws FORBIDDEN unless `email` is on the allowlist. Defense-in-depth for the
 *  recovery actions (the page already 404s non-superadmins). */
export function assertPathwaySuperadmin(email: string | null | undefined): void {
  if (!isPathwaySuperadmin(email)) {
    throw new ActionError("FORBIDDEN", "Not authorized.")
  }
}
