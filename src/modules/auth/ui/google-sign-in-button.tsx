"use client"

import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"

/**
 * "Continue with Google" — an OPTIONAL alternate to email+password sign-in.
 * Rendered only when Google is configured (the page passes `googleEnabled`);
 * email/password is always available regardless.
 *
 * `callbackURL="/"` routes through the root entry point (`app/page.tsx`), which
 * resolves the user's active org and sends them to onboarding (new user) or the
 * dashboard (returning) — so one destination handles both cases.
 */
export function GoogleSignInButton({ callbackURL = "/" }: { callbackURL?: string }) {
  const [redirecting, setRedirecting] = useState(false)

  async function onClick() {
    setRedirecting(true)
    try {
      await authClient.signIn.social({ provider: "google", callbackURL })
      // On success the browser navigates to Google; nothing else runs here.
    } catch {
      // Only reached if the redirect never started (e.g. network/config error).
      setRedirecting(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => void onClick()}
      disabled={redirecting}
    >
      <GoogleIcon />
      {redirecting ? "Redirecting…" : "Continue with Google"}
    </Button>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.38Z"
      />
      <path
        fill="#34A853"
        d="M12 23.5c3.1 0 5.71-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.03-6.45-4.75H1.7v2.98A11.5 11.5 0 0 0 12 23.5Z"
      />
      <path
        fill="#FBBC05"
        d="M5.55 14.17a6.9 6.9 0 0 1 0-4.34V6.85H1.7a11.5 11.5 0 0 0 0 10.3l3.85-2.98Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.74c1.69 0 3.2.58 4.4 1.72l3.3-3.3C17.71 1.26 15.1.25 12 .25A11.5 11.5 0 0 0 1.7 6.85l3.85 2.98C6.46 6.77 9 4.74 12 4.74Z"
      />
    </svg>
  )
}
