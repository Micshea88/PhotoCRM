"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { isValidCallbackUrl } from "@/modules/auth/callback-url"

/**
 * Push 2c.6.11 — verification runner now honors `?callbackURL=`.
 *
 * BA's signUp.email accepts a `callbackURL` parameter that it bakes
 * into the verification email link. When the user clicks the link
 * they land here (`/verify-email?token=...&callbackURL=ENCODED`).
 * Before this push the runner only read `?token=` and hardcoded
 * `router.push("/dashboard")`, which sent invite-flow users to
 * `/onboarding/create-organization` (the "Create your studio" trap
 * Mike reported).
 *
 * The runner now:
 *   1. Reads `?callbackURL=` (already URL-decoded by URLSearchParams),
 *   2. Validates it through `isValidCallbackUrl` — same path-prefix
 *      allowlist used by sign-up to set the callbackURL upstream,
 *      enforced again here as defense-in-depth (an attacker could
 *      manually craft a verification URL with an evil callbackURL),
 *   3. Passes the validated callbackURL to `authClient.verifyEmail`
 *      so BA's native HTTP-level redirect kicks in,
 *   4. Falls back to `/dashboard` if the callbackURL is missing or
 *      fails validation.
 *
 * The cookie that BA sets via `autoSignInAfterVerification` arrives
 * with the API response; by the time `router.push(callbackURL)` runs
 * the browser has the session, so the destination renders authed
 * without a sign-in detour.
 */
export function VerifyEmailRunner() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token")
  const rawCallbackURL = params.get("callbackURL")
  const callbackURL = isValidCallbackUrl(rawCallbackURL) ? rawCallbackURL : "/dashboard"
  const ran = useRef(false)
  const [state, setState] = useState<"idle" | "ok" | "error">("idle")
  const [message, setMessage] = useState<string>("")

  useEffect(() => {
    if (ran.current || !token) return
    ran.current = true
    void (async () => {
      // Pass the validated callbackURL through to BA so its server-
      // side redirect logic agrees with what we'll router.push to.
      // BA's GET /verify-email endpoint redirects on success when
      // callbackURL is present (crud-invites peer-route uses the
      // same pattern). When called via the JS client the response
      // is JSON, but BA still observes the param so the redirect
      // semantics are documented + consistent.
      const result = await authClient.verifyEmail({
        query: { token, callbackURL },
      })
      if (result.error) {
        setState("error")
        setMessage(result.error.message ?? "Verification failed")
        return
      }
      setState("ok")
      setTimeout(() => {
        router.push(callbackURL)
        router.refresh()
      }, 800)
    })()
  }, [token, callbackURL, router])

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertDescription>This verification link is invalid.</AlertDescription>
      </Alert>
    )
  }
  if (state === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }
  if (state === "ok") {
    return (
      <Alert>
        <AlertDescription>Email verified. Redirecting…</AlertDescription>
      </Alert>
    )
  }
  return <p className="text-sm text-[var(--color-muted-foreground)]">Verifying your email…</p>
}
