"use server"

import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { ActionError, authAction } from "@/lib/safe-action"
import { member, user } from "./schema"

/**
 * Push 2c.6.11 — sign-in active-org resolution.
 *
 * Better Auth's session cookie carries `activeOrganizationId` but
 * does NOT persist a per-user "remember the last one" preference.
 * Across sign-out/sign-in cycles, the cookie is destroyed and
 * rebuilt blank. Pre-2c.6.11 the sign-in form picked `orgs[0]`
 * arbitrarily — fine for a single-tenant V1, dangerous when users
 * belong to multiple orgs (the "first" pick is whatever BA returns
 * first, which is creation-time order = not user-intent-order).
 *
 * This action returns the orgId the sign-in flow should activate,
 * or null when the user should land in the org-switcher state (or
 * onboarding) without an auto-pick.
 *
 * Priority:
 *   1. user.last_active_organization_id IS NOT NULL AND user is
 *      still a member of that org → restore it.
 *   2. user has exactly ONE membership → auto-pick that one.
 *   3. user has MULTIPLE memberships AND no valid last-active →
 *      return null (the switcher in the topbar handles selection
 *      on first page load).
 *   4. user has ZERO memberships → return null (onboarding flow
 *      handles via its own redirect).
 */
export const resolveSignInActiveOrg = authAction
  .metadata({ actionName: "auth.resolve_signin_active_org" })
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    const [u] = await ctx.db
      .select({ lastActiveOrganizationId: user.lastActiveOrganizationId })
      .from(user)
      .where(eq(user.id, ctx.session.user.id))
      .limit(1)
    if (!u) {
      throw new ActionError("NOT_FOUND", "User row missing.")
    }
    const memberships = await ctx.db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, ctx.session.user.id))
    const memberOrgIds = new Set(memberships.map((m) => m.organizationId))

    // Priority 1: last-active still valid
    if (u.lastActiveOrganizationId && memberOrgIds.has(u.lastActiveOrganizationId)) {
      return { organizationId: u.lastActiveOrganizationId }
    }
    // Priority 2: single membership
    if (memberOrgIds.size === 1) {
      const [only] = Array.from(memberOrgIds)
      return { organizationId: only ?? null }
    }
    // Priority 3 + 4: multi or zero → caller handles
    return { organizationId: null }
  })

/**
 * Push 2c.6.11 — persist user.last_active_organization_id so the
 * next sign-in lands the user back in the org they were last using.
 *
 * Pre-conditions enforced:
 *   - Session exists (authAction wraps).
 *   - The session user is an active member of the orgId being set.
 *     Without this check an attacker could write any orgId — even
 *     one they don't belong to. The next sign-in would then try to
 *     restore an org the user isn't a member of; we'd discover that
 *     at sign-in time and fall through, but the WRITE itself is
 *     still wrong shape and worth refusing at the action boundary.
 *
 * Idempotent: writing the same orgId twice is a no-op for the
 * downstream UX. The wrapper around `authClient.organization.setActive`
 * (see ui/persist-active-org.ts) drives this in tandem with BA's
 * own session-cookie update.
 */
export const setLastActiveOrganization = authAction
  .metadata({ actionName: "auth.set_last_active_organization" })
  .inputSchema(z.object({ organizationId: z.string().min(1).max(64) }))
  .action(async ({ parsedInput, ctx }) => {
    const [m] = await ctx.db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, ctx.session.user.id),
          eq(member.organizationId, parsedInput.organizationId),
        ),
      )
      .limit(1)
    if (!m) {
      throw new ActionError("FORBIDDEN", "You are not a member of that organization.")
    }
    await ctx.db
      .update(user)
      .set({ lastActiveOrganizationId: parsedInput.organizationId })
      .where(eq(user.id, ctx.session.user.id))
    return { ok: true as const }
  })

/**
 * Clear the user's last-active org preference. Called when an org
 * the user has set as last-active is left/deleted under them. ON
 * DELETE SET NULL on the FK already covers the delete case; this
 * is here for the leave-org flow + admin-removed-me flow.
 */
export const clearLastActiveOrganization = authAction
  .metadata({ actionName: "auth.clear_last_active_organization" })
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    await ctx.db
      .update(user)
      .set({ lastActiveOrganizationId: null })
      .where(eq(user.id, ctx.session.user.id))
    return { ok: true as const }
  })
