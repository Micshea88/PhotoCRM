import { redirect } from "next/navigation"
import { headers } from "next/headers"
import type { ReactNode } from "react"
import { auth } from "@/lib/auth"
import { runWithOrgContext, withOrgContext } from "@/lib/org-context"
import { resolveActiveOrg } from "@/lib/resolve-active-org"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getUserOrganizations } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { resolveSidebarItems } from "@/modules/org/ui/app-sidebar"
import { AppTopbar } from "@/modules/org/ui/app-topbar"
import { ClientLayoutShell } from "@/modules/org/ui/client-layout-shell"
import { getDialerBootstrap } from "@/modules/telephony/queries"
import { DialerProvider, type DialerBootstrapClient } from "@/modules/telephony/ui/dialer-context"
import { DockedDialer } from "@/modules/telephony/ui/docked-dialer"
import { getUserPreference } from "@/modules/user-preferences/queries"
import { unreadCount as getUnreadCount } from "@/modules/notifications/queries"
import { listExpiredConnectionsForUser } from "@/modules/email-connections/queries"

/**
 * Server-side bootstrap fetch for the inline dialer. Returns null on
 * ANY failure (no RC connection, transient RC error, missing env
 * config) — the DialerProvider absorbs null by rendering an empty
 * API and the DockedDialer renders nothing. The fact that the
 * widget is invisible is the signal to the user that RC isn't
 * configured; the dedicated Settings → Integrations page is the
 * setup surface, not this widget.
 */
async function tryDialerBootstrap(
  organizationId: string,
  userId: string,
): Promise<DialerBootstrapClient | null> {
  try {
    const b = await getDialerBootstrap({ organizationId, userId })
    return {
      accessToken: b.accessToken,
      accessTokenExpiresAt: b.accessTokenExpiresAt.toISOString(),
      sipInfo: b.sipInfo,
      externalUserId: b.externalUserId,
    }
  } catch {
    return null
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")

  const organizations = await getUserOrganizations(session.user.id)
  const sessionOrgId = session.session.activeOrganizationId ?? null

  // Resolve the active org against the AUTHORITATIVE membership list. This
  // handles three cases in one place:
  //   - unset (fresh sign-in): Better Auth doesn't restore the previous active
  //     org, so auto-pick the first membership.
  //   - stale/revoked: the session still points at an org the user was removed
  //     from (NOT in `organizations`) — repick the first membership, or clear.
  //   - valid: keep it.
  // SECURITY + LOOP FIX: resolveActiveOrg NEVER returns a revoked org, so a
  // stale id can't establish org context. Persisting the result (null CLEARS
  // it in the server-side session) is what stops the stale id from bouncing
  // create-organization → dashboard (the ERR_TOO_MANY_REDIRECTS loop).
  const activeOrgId = resolveActiveOrg(sessionOrgId, organizations)
  if (activeOrgId !== sessionOrgId) {
    await auth.api.setActiveOrganization({
      headers: await headers(),
      body: { organizationId: activeOrgId },
    })
  }

  if (!activeOrgId) {
    // No memberships (or the only referenced org was revoked and cleared) —
    // render shell-less so onboarding owns its UI. NEVER redirect into (app).
    return <>{children}</>
  }

  // Resolve the role from Better Auth's `member` table first (no RLS — BA
  // tables are excluded by design). Then look up the extended 8-role from
  // member_role for the assignment-scoped RLS overlay. Fall back to the
  // BA→extended mapping if member_role hasn't been seeded for this user
  // (documented Layer 2 fallback in rbac/README.md).
  //
  // SECURITY (defense-in-depth): fail CLOSED if the member row is missing.
  // resolveActiveOrg already guarantees `activeOrgId` is a current membership,
  // so this should always find the row. If it somehow doesn't, render
  // shell-less — NEVER default the role to "member" (the original hole) and
  // NEVER redirect into an (app) route (that was the loop). Rendering
  // shell-less serves no org data and cannot loop.
  const memberRow = await getCurrentMember(activeOrgId, session.user.id)
  if (!memberRow) return <>{children}</>
  const baRole = memberRow.role as BetterAuthRole
  const tentativeExtended = extendedFromBetterAuth(baRole)

  // First short-lived ALS scope: set context with the tentative extended
  // role so the member_role SELECT below is RLS-allowed (member_role's
  // FOR-SELECT policy is open to any org member; we just need
  // app.current_org set).
  const extendedRole =
    (await runWithOrgContext(
      { orgId: activeOrgId, role: tentativeExtended, userId: session.user.id },
      async () => getExtendedMemberRole(session.user.id),
    )) ?? tentativeExtended

  const activeOrg = organizations.find((o) => o.id === activeOrgId)
  const studioName = activeOrg?.name ?? "Studio"

  // Pre-compute the sidebar items + UI prefs INSIDE a runWithOrgContext
  // scope. hasPermission + getUserPreference need ALS to be active,
  // and in Next.js production RSC the layout's ALS scope does NOT
  // propagate into async child server components — those render
  // outside the layout's frame. Resolve here, fully await, and pass
  // plain values to the client wrapper.
  const {
    sidebarItems,
    navCollapsed,
    settingsExpanded,
    dialerBootstrap,
    initialUnreadCount,
    initialExpiredConnections,
  } = await runWithOrgContext(
    { orgId: activeOrgId, role: extendedRole, userId: session.user.id },
    async () => {
      const [items, navPref, settingsPref, bootstrap, unread, expiredConns] = await Promise.all([
        resolveSidebarItems(session.user.id, extendedRole),
        getUserPreference("nav_collapsed", null),
        getUserPreference("nav_settings_expanded", null),
        tryDialerBootstrap(activeOrgId, session.user.id),
        withOrgContext((db) => getUnreadCount(db, activeOrgId, session.user.id)),
        withOrgContext((db) => listExpiredConnectionsForUser(db, activeOrgId, session.user.id)),
      ])
      return {
        sidebarItems: items,
        // Cast jsonb unknown → boolean; defaults to false when unset
        // or any non-boolean (defensive against forward-incompat
        // value shapes).
        navCollapsed: navPref === true,
        settingsExpanded: settingsPref === true,
        dialerBootstrap: bootstrap,
        initialUnreadCount: unread,
        // Slim projection: only id + email needed by the banner.
        // Date columns are excluded to keep the client-boundary payload
        // minimal and JSON-safe without conversion.
        initialExpiredConnections: expiredConns.map((c) => ({ id: c.id, email: c.email })),
      }
    },
  )

  return (
    <div className="flex h-screen flex-col">
      <AppTopbar
        user={{ name: session.user.name, email: session.user.email }}
        studioName={studioName}
        organizations={organizations.map((o) => ({ id: o.id, name: o.name, slug: o.slug }))}
        activeOrgId={activeOrgId}
        initialUnreadCount={initialUnreadCount}
        className="border-b border-[var(--color-border)]"
      />
      <ClientLayoutShell
        sidebarItems={sidebarItems}
        initialCollapsed={navCollapsed}
        initialSettingsExpanded={settingsExpanded}
        initialExpiredConnections={initialExpiredConnections}
      >
        <DialerProvider bootstrap={dialerBootstrap}>
          {children}
          <DockedDialer />
        </DialerProvider>
      </ClientLayoutShell>
    </div>
  )
}
