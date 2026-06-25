import "server-only"
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto"
import { env } from "@/lib/env"

/**
 * Server-only crypto for share links (Commit 3).
 *
 * - Tokens: 192-bit CSPRNG (randomBytes), stored in the DB, NEVER derived from
 *   any server secret (OWASP session-token guidance).
 * - Passcodes: 6-digit numeric (a FILE passcode, not an account credential),
 *   stored BOTH hashed (per-passcode scrypt salt, no server-wide pepper) and
 *   plaintext (photographer display) — an explicit product decision. Rate
 *   limiting (share-link-core) is the primary brute-force defense.
 *
 * SHARE_LINK_HMAC_SECRET — cookie signing key, ROTATABLE:
 *   - Rotating it ONLY invalidates already-issued "passcode verified" cookies
 *     (the recipient simply re-enters the passcode). It NEVER invalidates the
 *     share link itself or the passcode itself — those live in the DB.
 *   - Grace period: the env var is comma-separated. New cookies are signed with
 *     the FIRST secret; cookies verify against ANY listed secret. Rotation =
 *     prepend the new secret, redeploy (old cookies still verify, new ones use
 *     the new key), then drop the old secret after the grace window.
 *   - If unset, falls back to BETTER_AUTH_SECRET (backwards-compat during the
 *     rollout); set a dedicated value to separate the security domains.
 */

/** Unguessable URL-safe token for the public share link. */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url")
}

/** 6-digit numeric passcode, zero-padded. */
export function generatePasscode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

/** Salted scrypt hash, stored as `salt:hash` (hex). */
export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(passcode, salt, 32)
  return `${salt.toString("hex")}:${derived.toString("hex")}`
}

/** Constant-time verify against a `salt:hash` string. */
export function verifyPasscode(passcode: string, stored: string | null): boolean {
  if (!stored) return false
  const [saltHex, hashHex] = stored.split(":")
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, "hex")
  const expected = Buffer.from(hashHex, "hex")
  const derived = scryptSync(passcode, salt, expected.length)
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}

/**
 * Signed value for the per-link "passcode verified" cookie. HMAC over the token
 * so a recipient who passed the passcode can download without re-entering, but
 * the cookie can't be forged without the server secret (knowing the token alone
 * isn't enough to bypass the passcode gate).
 */
/** Active signing secrets, newest first. Comma-separated for rotation; falls
 *  back to BETTER_AUTH_SECRET (always present) during rollout. */
function shareLinkHmacSecrets(): string[] {
  const raw = env.SHARE_LINK_HMAC_SECRET
  if (raw) {
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (list.length > 0) return list
  }
  return [env.BETTER_AUTH_SECRET]
}

function hmac(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("base64url")
}

/** Sign with the FIRST (current) secret. */
export function accessCookieValue(token: string): string {
  return hmac(shareLinkHmacSecrets()[0] ?? env.BETTER_AUTH_SECRET, token)
}

/** Verify against ANY active secret (rotation grace period). */
export function verifyAccessCookie(token: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false
  const candidate = Buffer.from(cookieValue)
  for (const secret of shareLinkHmacSecrets()) {
    const expected = Buffer.from(hmac(secret, token))
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true
  }
  return false
}
