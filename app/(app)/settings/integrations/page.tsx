import { redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { IntegrationsBrowser } from "@/modules/integrations/ui/integrations-browser"
import {
  IntegrationsPageTabs,
  type IntegrationsTabId,
} from "@/modules/integrations/ui/integrations-page-tabs"
import { ConnectedAppsEmpty } from "@/modules/integrations/ui/connected-apps-empty"
import { ConnectedAppsList } from "@/modules/integrations/ui/connected-apps-list"
import { listConnectedProvidersForOrg } from "@/modules/telephony/queries"
import { PageContainer } from "@/modules/shared/ui/page-container"

/**
 * /settings/integrations — Browse + Connected Apps tabbed view.
 *
 * Reachable by ALL members (Item 2) so every photographer can connect their own
 * email. Browse + the Connected Apps list are read-only; connect/disconnect is
 * gated where it matters (email = per-user for everyone; RingCentral = owner/
 * admin only) downstream in the provider wizard / email picker.
 *
 * The active tab is driven by ?view=<id>. Falls back to "browse"
 * when missing or unknown. Connected Apps renders the live list
 * when telephony_connections has rows for this org; the empty
 * state when not.
 */

function resolveActiveTab(raw: string | undefined): IntegrationsTabId {
  if (raw === "connected" || raw === "browse") return raw
  return "browse"
}

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  if (!member) redirect("/dashboard")
  const baRole = member.role as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const extendedRole =
    (await runWithOrgContext({ orgId, role: tentativeRole, userId: session.user.id }, async () =>
      getExtendedMemberRole(session.user.id),
    )) ?? tentativeRole

  const params = await searchParams
  const active = resolveActiveTab(params.view)

  // Live read — only when the user is actually on the Connected tab.
  // Browse doesn't need it.
  const connectedRows =
    active === "connected"
      ? await runWithOrgContext({ orgId, role: extendedRole, userId: session.user.id }, async () =>
          listConnectedProvidersForOrg(),
        )
      : []

  return (
    <PageContainer variant="default" className="space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-semibold">Integrations</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          Connect phone, calendar, email, and payment providers so the CRM can talk to the tools you
          already use.
        </p>
      </header>
      <IntegrationsPageTabs active={active} />
      {active === "browse" ? (
        <IntegrationsBrowser />
      ) : connectedRows.length > 0 ? (
        <ConnectedAppsList rows={connectedRows} />
      ) : (
        <ConnectedAppsEmpty />
      )}
    </PageContainer>
  )
}
