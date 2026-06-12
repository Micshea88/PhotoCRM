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
  vercelBranchUrl: string | undefined
}): { baseURL: string; trustedOrigins: string[] } {
  if (input.vercelEnv !== "preview") {
    return { baseURL: input.betterAuthUrl, trustedOrigins: [input.betterAuthUrl] }
  }
  // PREVIEW ONLY. Vercel exposes a deploy under more than one .vercel.app
  // domain (the deployment URL in VERCEL_URL and the branch alias in
  // VERCEL_BRANCH_URL) and the tester may load either. Trust BOTH EXACT
  // origins — never a `*.vercel.app` wildcard, which would trust the whole
  // shared Vercel tenant (any attacker's *.vercel.app app) and is a CSRF /
  // origin-bypass surface.
  const previewUrl = input.vercelUrl ? `https://${input.vercelUrl}` : null
  const branchUrl = input.vercelBranchUrl ? `https://${input.vercelBranchUrl}` : null
  const exactOrigins = [previewUrl, branchUrl].filter((o): o is string => o !== null)
  if (exactOrigins.length === 0) {
    // Preview but Vercel exposed no domain — fall back to canonical config.
    return { baseURL: input.betterAuthUrl, trustedOrigins: [input.betterAuthUrl] }
  }
  return {
    // Prefer the stable branch alias for absolute links (email reset/verify);
    // fall back to the exact deployment URL.
    baseURL: branchUrl ?? previewUrl ?? input.betterAuthUrl,
    trustedOrigins: [input.betterAuthUrl, ...exactOrigins],
  }
}
