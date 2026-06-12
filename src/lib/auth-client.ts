"use client"
import { createAuthClient } from "better-auth/react"
import { organizationClient } from "better-auth/client/plugins"
import { env } from "@/lib/env"

// Always call the auth API on the SAME origin the page is served from.
// A hardcoded production baseURL meant that on a Vercel preview domain the
// client posted cross-origin to production — the Set-Cookie landed on the
// production domain, never first-party on the preview, so sign-in could
// never establish a session there. `window.location.origin` is the current
// origin on prod AND preview (identical to NEXT_PUBLIC_APP_URL on the
// canonical production domain, so production behavior is unchanged); the env
// value is only the SSR-eval fallback and is never used for a real fetch
// (all auth calls run in the browser).
const clientBaseURL =
  typeof window !== "undefined" ? window.location.origin : env.NEXT_PUBLIC_APP_URL

export const authClient = createAuthClient({
  baseURL: clientBaseURL,
  plugins: [organizationClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient
