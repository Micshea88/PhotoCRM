/**
 * Push 2c.6.11 — `callbackURL` validator for the email-verification
 * round-trip and any other place we accept a redirect target from
 * the URL query string.
 *
 * Open-redirect defense: a malicious link could ship a victim a URL
 * like
 *
 *   https://photo-crm-three.vercel.app/verify-email?
 *     token=valid-token&callbackURL=https%3A%2F%2Fevil.example.com
 *
 * If we blindly `router.push(callbackURL)` after a successful BA
 * verification, the user lands on the attacker's site WHILE still
 * inside their authenticated session — perfect setup for credential-
 * harvest phishing or CSRF.
 *
 * The locked allowlist is path-prefix only:
 *   - `/accept-invite/` (the invitation-flow target)
 *   - `/dashboard`      (the post-signup default)
 *   - `/onboarding/`    (first-time org creation)
 *
 * Anything else falls back to `/dashboard` at the call site. The
 * validator returns a boolean — the caller decides the default.
 *
 * Rejection rules (tested in callback-url.test.ts):
 *   - null / undefined / non-string → false
 *   - empty string → false
 *   - absolute URL (starts with http://, https://, //, or any
 *     protocol-like prefix) → false
 *   - protocol-relative URL (//evil.example.com) → false
 *   - javascript: / data: / file: pseudo-protocols → false
 *   - path traversal attempts (any `..` segment) → false
 *   - paths outside the three allowed prefixes → false
 *
 * Accepted shapes:
 *   - `/accept-invite/<token>`
 *   - `/dashboard`
 *   - `/dashboard?x=y`
 *   - `/onboarding/create-organization`
 *   - `/onboarding/...` (any sub-path)
 */

const ALLOWED_PREFIXES = ["/accept-invite/", "/dashboard", "/onboarding/"] as const

export function isValidCallbackUrl(url: string | null | undefined): url is string {
  if (typeof url !== "string" || url.length === 0) return false
  // First char must be exactly `/` — that rules out absolute and
  // protocol-relative URLs in one check. A real same-origin path
  // never starts with anything else.
  if (!url.startsWith("/")) return false
  // Second char must NOT be `/` — protocol-relative URLs like
  // `//evil.example.com/path` would otherwise sneak past the
  // first-char check above.
  if (url.startsWith("//")) return false
  // Pseudo-protocols that begin with a slash because the attacker
  // URL-encoded the colon? Not a real concern — `decodeURIComponent`
  // happens at the call site, and after decoding `%3A` becomes `:`,
  // which still wouldn't pass the first-char `/` check. Belt-and-
  // suspenders: reject anything containing `:` before the first
  // path separator.
  const firstSlashAfterStart = url.indexOf("/", 1)
  const head = firstSlashAfterStart === -1 ? url : url.slice(0, firstSlashAfterStart)
  if (head.includes(":")) return false
  // Path traversal — any `..` segment is rejected even if it'd
  // technically resolve to an allowed prefix.
  if (url.includes("..")) return false
  // Allowlist match. Two patterns:
  //
  //   - Prefix ending in `/` (e.g. `/accept-invite/`, `/onboarding/`):
  //     accept only if `url.startsWith(prefix)`. This guarantees a
  //     separator follows so `/accept-invitex` won't sneak past.
  //
  //   - Prefix NOT ending in `/` (e.g. `/dashboard`): accept the
  //     EXACT match plus `/dashboard/`, `/dashboard?`, `/dashboard#`.
  //     A bare prefix match like `/dashboardish` is rejected — that
  //     would be a completely unrelated route.
  return ALLOWED_PREFIXES.some((prefix) => {
    if (prefix.endsWith("/")) {
      return url.startsWith(prefix)
    }
    if (url === prefix) return true
    return (
      url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`) || url.startsWith(`${prefix}#`)
    )
  })
}
