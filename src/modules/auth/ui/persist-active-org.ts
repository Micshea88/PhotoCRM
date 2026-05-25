"use client"

import { authClient } from "@/lib/auth-client"
import { setLastActiveOrganization } from "@/modules/auth/actions"

/**
 * Push 2c.6.11 — client-side helper that sets BA's active org
 * AND persists user.last_active_organization_id in our DB. Both
 * have to happen for the next-sign-in restoration to work.
 *
 *   - BA's `authClient.organization.setActive` updates the session
 *     cookie's `activeOrganizationId` field. That's what the
 *     authenticated request handlers read on every page load.
 *   - Our `setLastActiveOrganization` server action persists the
 *     pick to user.last_active_organization_id so the next
 *     sign-in (which destroys + rebuilds the cookie) can rehydrate
 *     the user's choice.
 *
 * If the persist step fails (server action error, network blip)
 * we still completed the BA setActive — the user's current session
 * is correct. The next sign-in just falls through to single-org
 * auto-pick or no-pick, which is the safe default.
 *
 * Use this wrapper EVERYWHERE we set the active org from our own
 * UI: sign-in form, org-switcher, accept-invite runner, post-org-
 * creation. Direct calls to `authClient.organization.setActive`
 * outside of this wrapper skip the persistence and should be a
 * code-review red flag.
 */
export async function setActiveOrgAndPersist(organizationId: string): Promise<{ ok: boolean }> {
  const baResult = await authClient.organization.setActive({ organizationId })
  if (baResult.error) {
    return { ok: false }
  }
  // Best-effort persist — if it errors (e.g. transient), the
  // current session is still correct. Next sign-in falls back to
  // single-org auto-pick or no-pick.
  try {
    await setLastActiveOrganization({ organizationId })
  } catch {
    // Silently swallow; logged client-side via the action's
    // built-in error capture.
  }
  return { ok: true }
}
