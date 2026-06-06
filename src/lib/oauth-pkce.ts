import "server-only"
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { env } from "@/lib/env"

/**
 * Tiny PKCE + state helper for server-side OAuth flows.
 *
 * THIS REPO'S FIRST third-party OAuth. The pattern is:
 *
 *   1. Server-side: generate a high-entropy `verifier`. Hash with
 *      SHA-256, base64url-encode → `challenge`. Send `challenge` to
 *      the provider on the authorize redirect.
 *   2. Persist the verifier somewhere only the server can read,
 *      keyed to the current session. We use a path-scoped, httpOnly,
 *      sameSite=lax cookie. The browser carries it back automatically
 *      on the callback request; the JS in the page never sees it.
 *   3. On callback: read verifier from the cookie, send it to the
 *      token endpoint alongside the code. The provider re-hashes it
 *      and verifies the SHA-256 matches the challenge it stored.
 *
 * State is the OAuth CSRF token. We HMAC-sign it (BETTER_AUTH_SECRET
 * + userId) so a swapped-in callback from a different user — even in
 * the same browser — fails the verify step. Constant-time compared
 * on the way back.
 *
 * `code_challenge_method` is always S256 — the only sane choice for
 * a server that can hash. RingCentral, Google, Microsoft, and every
 * other current OAuth 2.1 provider supports it.
 */

const VERIFIER_BYTES = 32 // 32 bytes → ~43-char base64url string

/** RFC 4648 §5 base64url, no padding. */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Generate a fresh PKCE verifier — high-entropy, URL-safe. */
export function generateVerifier(): string {
  return base64url(randomBytes(VERIFIER_BYTES))
}

/** Derive the S256 challenge from a verifier. */
export function verifierToChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest())
}

/**
 * Pack a random nonce + userId into an HMAC-signed `state` value.
 * Format on the wire: `<base64url(nonce)>.<base64url(hmac)>`.
 *
 * The userId is baked INTO the MAC input (not the visible nonce), so
 * the value handed to the provider doesn't disclose which user it
 * belongs to — only the server, with the secret, can prove it
 * matches a given session.
 */
export function signState(userId: string): string {
  const nonce = base64url(randomBytes(16))
  const mac = createHmac("sha256", env.BETTER_AUTH_SECRET).update(`${nonce}:${userId}`).digest()
  return `${nonce}.${base64url(mac)}`
}

/**
 * Verify a state value against the expected user. Returns true only
 * when the MAC matches and the comparison ran in constant time. Any
 * malformed input returns false without throwing — the callback
 * surfaces a generic error to the user, not a parse trace.
 */
export function verifyState(state: string, userId: string): boolean {
  if (typeof state !== "string") return false
  const dot = state.indexOf(".")
  if (dot <= 0 || dot === state.length - 1) return false
  const nonce = state.slice(0, dot)
  const providedMacB64 = state.slice(dot + 1)
  const expectedMac = createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`${nonce}:${userId}`)
    .digest()
  let providedMac: Buffer
  try {
    providedMac = Buffer.from(providedMacB64.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  } catch {
    return false
  }
  if (providedMac.length !== expectedMac.length) return false
  return timingSafeEqual(providedMac, expectedMac)
}
