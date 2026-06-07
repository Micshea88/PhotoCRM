import type { ReactNode } from "react"
import { Suspense } from "react"
import { withPageOrgContext } from "@/lib/page-org-context"
import { getDialerBootstrap } from "@/modules/telephony/queries"
import { RingCentralAuthError, RingCentralTransientError } from "@/modules/telephony/token-refresh"
import { RingCentralOAuthNotConfigured } from "@/modules/telephony/ringcentral-oauth"
import { DialerShell } from "@/modules/telephony/ui/dialer-shell"

/**
 * Popup-dialer authenticated route.
 *
 * Lives at the TOP LEVEL of `app/` (outside `(app)` and `(auth)`
 * route groups) so it inherits ONLY `app/layout.tsx` (root layout —
 * ThemeProvider, Analytics, SpeedInsights) and not the (app) group's
 * sidebar + topbar chrome. Phone-shape popup window (420×720, opened
 * by `src/lib/open-dialer.ts`) — no surrounding navigation.
 *
 * Boot sequence:
 *   1. `withPageOrgContext` resolves the session, redirects unauth'd
 *      users to /sign-in, sets the org-context ALS scope so
 *      `getDialerBootstrap` (which uses RLS-scoped reads) sees the
 *      current member.
 *   2. `getDialerBootstrap` returns a fresh access token + RC SIP-
 *      provisioning grant + expiry + external user id in one
 *      server-side round-trip.
 *   3. Suspense-wrapped `<DialerShell>` mounts; reads URL params
 *      (?to=&contactId=&contactLabel=) for first-dial intent; opens
 *      a BroadcastChannel listener for subsequent dials.
 *
 * Boot-time error handling (NOT silent — opposed to the mid-call
 * silent-self-healing UX):
 *   - `RingCentralOAuthNotConfigured` — dev-only path when RC env
 *     vars are unset. In production, `env.ts` validation prevents
 *     this at boot, so this branch is dead in prod; we still handle
 *     it for dev clarity to avoid an unhandled-exception crash.
 *   - `RingCentralAuthError` — no live RC connection for this user
 *     (or RC rejected the refresh-token grant). User must reconnect.
 *   - `RingCentralTransientError` — RC returned 5xx or fetch failed.
 *     Render a retry link (`href=""` re-fires the same URL so the
 *     ?to=&contactId=&contactLabel= dial intent survives the retry).
 *   - Anything else — re-throw to Next.js's default error boundary.
 *
 * The user opened a popup expecting a dialer; bouncing them away or
 * staying silent leaves no path forward. The inline error views give
 * them an obvious next action (reconnect / contact admin / retry).
 */
export default async function DialerPage() {
  return withPageOrgContext(async (ctx) => {
    try {
      const bootstrap = await getDialerBootstrap({
        organizationId: ctx.orgId,
        userId: ctx.userId,
      })
      return (
        <div className="bg-background text-foreground flex h-screen w-screen flex-col">
          <Suspense fallback={<DialerBootingFallback />}>
            <DialerShell sipInfo={bootstrap.sipInfo} externalUserId={bootstrap.externalUserId} />
          </Suspense>
        </div>
      )
    } catch (err) {
      if (err instanceof RingCentralOAuthNotConfigured) {
        return <DialerBootErrorView kind="not_configured" />
      }
      if (err instanceof RingCentralAuthError || err instanceof RingCentralTransientError) {
        return (
          <DialerBootErrorView kind={err instanceof RingCentralAuthError ? "auth" : "transient"} />
        )
      }
      throw err
    }
  })
}

/**
 * Suspense fallback shown while DialerShell resolves its
 * `useSearchParams()` Next-16 requirement. Kept simple — the popup
 * is small (420×720) and a spinner would dominate the viewport.
 */
function DialerBootingFallback() {
  return (
    <div className="bg-background text-foreground flex h-screen w-screen items-center justify-center">
      <p className="text-sm text-[var(--color-muted-foreground)]">Loading dialer…</p>
    </div>
  )
}

type DialerBootErrorKind = "not_configured" | "auth" | "transient"

/**
 * Inline error view rendered when `getDialerBootstrap` throws at
 * boot. Kind-specific copy + a clear next action per kind. Inlined
 * in the page file (not a separate component) because it's single-
 * use and trivial.
 */
function DialerBootErrorView({ kind }: { kind: DialerBootErrorKind }) {
  let title: string
  let body: ReactNode
  switch (kind) {
    case "not_configured":
      title = "Dialer not configured"
      body = <p className="text-sm">Contact your administrator.</p>
      break
    case "auth":
      title = "RingCentral connection unavailable"
      body = (
        <p className="text-sm">
          Reconnect in{" "}
          <a
            href="/settings/integrations/phone/ringcentral"
            className="font-medium underline"
            target="_blank"
            rel="noopener"
          >
            Settings → Integrations → Phone → RingCentral
          </a>
          .
        </p>
      )
      break
    case "transient":
      title = "Could not start the dialer"
      body = (
        <>
          <p className="text-sm">A temporary error reached RingCentral.</p>
          {/*
           * Empty href reloads the current URL per HTML spec — preserves
           * the ?to=&contactId=&contactLabel= dial intent across retry
           * so the user doesn't have to close+re-click from the contact
           * card to recover from a transient RC blip.
           */}
          <a href="" className="text-sm font-medium underline">
            Retry
          </a>
        </>
      )
      break
  }
  return (
    <div className="bg-background text-foreground flex h-screen w-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      {body}
    </div>
  )
}
