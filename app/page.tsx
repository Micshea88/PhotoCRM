import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getSession } from "@/modules/auth/session"
import { getUserOrganizations } from "@/modules/org/queries"
import { resolveActiveOrg } from "@/lib/resolve-active-org"

/**
 * Root entry point + org-resolution gate. Auth-aware routing:
 *
 *   - signed-out users go to the sign-in screen
 *   - signed-in users land on the dashboard (or onboarding if they have no org)
 *
 * Better Auth does NOT restore `activeOrganizationId` across sign-in — and the
 * Google OAuth flow (unlike the email form) has no client-side step to set it —
 * so we resolve the active org from the AUTHORITATIVE membership list here, the
 * same way the (app) layout does. That makes `callbackURL="/"` correct for BOTH
 * a returning social user (→ dashboard) and a brand-new one (→ onboarding).
 *
 * No anonymous landing page in V1 — the product is a studio CRM, not a public
 * marketing site.
 */
export default async function HomePage() {
  const session = await getSession()
  if (!session?.user) {
    redirect("/sign-in")
  }

  const organizations = await getUserOrganizations(session.user.id)
  const sessionOrgId = session.session.activeOrganizationId ?? null
  const activeOrgId = resolveActiveOrg(sessionOrgId, organizations)
  if (activeOrgId !== sessionOrgId) {
    await auth.api.setActiveOrganization({
      headers: await headers(),
      body: { organizationId: activeOrgId },
    })
  }

  if (!activeOrgId) {
    redirect("/onboarding/create-organization")
  }
  redirect("/dashboard")
}
