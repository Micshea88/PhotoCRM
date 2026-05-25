import Link from "next/link"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { getSession } from "@/modules/auth/session"
import { findStaleUserShellByEmail, getInvitationById } from "@/modules/org/queries"
import { AcceptInviteRunner } from "@/modules/org/ui/accept-invite-runner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/**
 * Push 2c.6.10 — explicit state machine for the accept-invite
 * page that NEVER redirect-loops. Nine states, only ONE allows a
 * server-side redirect (state 7); every other state renders an
 * inline UI with clear remediation.
 *
 *   1. Token doesn't resolve to an invitation row → render error
 *   2. status='canceled' → render canceled UI
 *   3. status='accepted' → render already-used UI
 *   4. expires_at < NOW() → render expired UI
 *   5. BLOCKER: user shell at this email is unverified, no
 *      membership, older than 30 minutes → render blocker UI
 *      ("Ask the inviter to reset this invitation")
 *   6. Session cookie present in browser but BA can't resolve
 *      it server-side (deleted user, expired session row, etc.)
 *      → clear the cookie inline via cookies().set(Max-Age=0)
 *      AND render dual CTA (Sign in / Create account). NO redirect.
 *   7. No session + invitation pending + not expired → ONE
 *      redirect to /sign-in?redirect=...&email=... (the only
 *      allowed redirect from this page).
 *   8. Session valid + email matches invitation → render
 *      AcceptInviteRunner as usual.
 *   9. Session valid + email mismatches → render
 *      AcceptInviteRunner; its existing client pre-flight handles
 *      the mismatch UI (Push 2c.6.8).
 *
 * State 6 is the load-bearing fix for the loop Mike hit tonight.
 * BA's getSession() at the API endpoint layer clears the cookie
 * via Set-Cookie when called via HTTP, but when called server-side
 * from this page (via `auth.api.getSession({ headers })`), the
 * cookie-clear doesn't propagate to the actual page response. So
 * we detect the disconnect — cookie present + session resolution
 * fails — and clear it ourselves.
 *
 * BA cookie names: `better-auth.session_token` (HTTP) or
 * `__Secure-better-auth.session_token` (HTTPS). Both must be cleared
 * for a clean state-6 recovery.
 */

const BA_COOKIE_NAMES = ["better-auth.session_token", "__Secure-better-auth.session_token"] as const

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invitation = await getInvitationById(token)

  // State 1 — token doesn't resolve
  if (!invitation) {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Invitation not found</h1>
        <Alert variant="destructive">
          <AlertDescription>
            This invitation link is invalid. Check that you opened the most recent invitation email,
            or ask the inviter to send a new one.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    )
  }

  // States 2, 3, 4 — non-pending status / expired
  if (invitation.status === "canceled") {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Invitation canceled</h1>
        <Alert variant="destructive">
          <AlertDescription>
            This invitation has been canceled. Ask {invitation.organizationName} to send a fresh
            invitation if you still need access.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  if (invitation.status === "accepted") {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Invitation already used</h1>
        <Alert variant="destructive">
          <AlertDescription>
            This invitation has already been accepted. Sign in to access{" "}
            {invitation.organizationName}.
          </AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    )
  }
  if (invitation.expiresAt < new Date()) {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Invitation expired</h1>
        <Alert variant="destructive">
          <AlertDescription>
            This invitation expired on {invitation.expiresAt.toLocaleDateString()}. Ask{" "}
            {invitation.organizationName} to send a fresh invitation.
          </AlertDescription>
        </Alert>
      </div>
    )
  }
  if (invitation.status !== "pending") {
    // Defensive — covers any BA-side statuses we don't model
    // explicitly (rejected, etc.). Render the same canceled-shape
    // UI rather than silently proceeding.
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Invitation unavailable</h1>
        <Alert variant="destructive">
          <AlertDescription>
            This invitation is no longer pending. Ask the inviter for a fresh one.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // State 5 — BLOCKER: stale unverified user shell at this email
  const blocker = await findStaleUserShellByEmail(invitation.email)
  if (blocker) {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Incomplete signup blocks this email</h1>
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium">
              A previous signup attempt at {invitation.email} was never completed.
            </p>
            <p className="mt-2">
              Ask {invitation.organizationName} to reset this invitation (Settings → Organization →
              Members → Reset). The reset will clear the orphan signup and send you a fresh invite.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const session = await getSession()

  // State 6 — stale session cookie (cookie present but BA can't
  // resolve to a real user). Push 2c.6.11 commit-A originally
  // tried to clear the cookie inline via cookies().set() but
  // Next.js 16 forbids cookie writes from a Server Component
  // (production 500: "Cookies can only be modified in a Server
  // Action or Route Handler", digest 4049270041). The fix: route
  // the user's button click through /api/auth/clear-stale-session,
  // a Route Handler that's allowed to write Set-Cookie. The
  // browser drops the cookie BEFORE following the handler's
  // redirect, so the next request lands cookie-free and proxy.ts
  // doesn't bounce.
  if (!session?.user) {
    const cookieStore = await cookies()
    const hasStaleCookie = BA_COOKIE_NAMES.some((name) => cookieStore.has(name))
    if (hasStaleCookie) {
      const acceptInvitePath = `/accept-invite/${token}`
      const innerQp = new URLSearchParams({
        redirect: acceptInvitePath,
        email: invitation.email,
      }).toString()
      // Each button hits the clear-stale-session handler with the
      // FINAL landing as its `?redirect=`. The handler validates
      // against its own allowlist (which includes /sign-in and
      // /sign-up), clears the BA cookies via Set-Cookie, then
      // 307s. The browser drops cookies on the response BEFORE
      // following the 307, so /sign-in (or /sign-up) lands cookie-
      // free and proxy.ts doesn't bounce.
      const signInTarget = `/api/auth/clear-stale-session?redirect=${encodeURIComponent(
        `/sign-in?${innerQp}`,
      )}`
      const signUpTarget = `/api/auth/clear-stale-session?redirect=${encodeURIComponent(
        `/sign-up?${innerQp}`,
      )}`
      return (
        <div className="space-y-6 text-center">
          <h1 className="text-2xl font-semibold">Sign in to accept</h1>
          <Alert>
            <AlertDescription>
              <p className="font-medium">Your previous session expired.</p>
              <p className="mt-2">
                Sign in with <strong>{invitation.email}</strong> or create an account with that
                email to accept this invitation to {invitation.organizationName}.
              </p>
            </AlertDescription>
          </Alert>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild>
              <a href={signInTarget}>Sign in</a>
            </Button>
            <Button asChild variant="outline">
              <a href={signUpTarget}>Create account</a>
            </Button>
          </div>
        </div>
      )
    }

    // State 7 — no cookie at all, no session. ONE allowed redirect.
    const params = new URLSearchParams({
      redirect: `/accept-invite/${token}`,
      email: invitation.email,
    })
    redirect(`/sign-in?${params.toString()}`)
  }

  // States 8 + 9 — session valid, email match or mismatch handled
  // client-side by AcceptInviteRunner (Push 2c.6.8 pre-flight).
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Join {invitation.organizationName}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          You&apos;ve been invited to join <strong>{invitation.organizationName}</strong> on
          Pathway. This invitation was sent to <strong>{invitation.email}</strong>.
        </p>
      </div>
      <AcceptInviteRunner
        invitationId={token}
        invitedEmail={invitation.email}
        currentUserEmail={session.user.email}
      />
    </div>
  )
}
