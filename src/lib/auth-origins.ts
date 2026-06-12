/**
 * Resolve Better Auth `baseURL` + `trustedOrigins` with Vercel preview
 * support.
 *
 * Vercel preview deployments get a per-deploy domain
 * (`<project>-git-<branch>-<scope>.vercel.app`) unknowable at config
 * time. Better Auth validates the request Origin against baseURL +
 * trustedOrigins; a hardcoded production baseURL rejects every preview
 * origin ("Invalid Origin") and the session cookie never lands
 * first-party on the preview domain — sign-in can't establish a session.
 *
 * On a PREVIEW deploy only, derive both from the exact `VERCEL_URL`
 * (NOT a `*.vercel.app` wildcard, which would broaden production's trust
 * set). Production and local are provably unchanged: they fall through
 * to `betterAuthUrl`, with `trustedOrigins = [betterAuthUrl]` — already
 * Better Auth's implicit default (the baseURL origin is always trusted).
 *
 * Pure + env-injected so it unit-tests without the server-only
 * auth/db import chain.
 */
export function resolveAuthOrigins(input: {
  betterAuthUrl: string
  vercelEnv: string | undefined
  vercelUrl: string | undefined
}): { baseURL: string; trustedOrigins: string[] } {
  const previewUrl =
    input.vercelEnv === "preview" && input.vercelUrl ? `https://${input.vercelUrl}` : null
  if (previewUrl) {
    // PREVIEW ONLY. Vercel exposes a deploy under several .vercel.app
    // domains (the deployment URL in VERCEL_URL, the branch alias, etc.) and
    // the tester may load any of them; the exact VERCEL_URL alone can miss.
    // Trust this exact origin AND a `*.vercel.app` wildcard. This is
    // preview-scoped — production (below) never gets the wildcard, so its
    // trust set is not broadened.
    return {
      baseURL: previewUrl,
      trustedOrigins: [input.betterAuthUrl, previewUrl, "https://*.vercel.app"],
    }
  }
  return { baseURL: input.betterAuthUrl, trustedOrigins: [input.betterAuthUrl] }
}
