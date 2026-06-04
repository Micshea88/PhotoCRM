import "server-only"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { env } from "@/lib/env"

/**
 * Symmetric encryption at rest for third-party OAuth tokens.
 *
 * Algorithm
 * ---------
 * AES-256-GCM. GCM is authenticated encryption — the auth tag detects any
 * tamper with the ciphertext at decrypt time, so a corrupted or wrong-key
 * read fails loudly rather than silently returning garbage.
 *
 * Wire format
 * -----------
 * The returned string is `v1:<base64>` where `<base64>` is the
 * concatenation `IV (12) || authTag (16) || ciphertext (N)`. Self-contained:
 * no separate iv/tag columns. The `v1:` prefix is forward-compat — a future
 * version (envelope key, key id, different cipher) can ship `v2:…` and the
 * decrypt path can fork on the prefix without breaking stored rows.
 *
 * Key
 * ---
 * `TELEPHONY_ENCRYPTION_KEY` is 32 bytes hex-encoded (64 chars). Generated
 * via `openssl rand -hex 32` and stored in Vercel project env vars (prod)
 * and `.env.local` (dev). The env schema (src/lib/env.ts) enforces the
 * shape — this module simply trusts it.
 *
 * Key-loss / rotation
 * -------------------
 * Losing or changing the key makes every previously-encrypted value
 * permanently undecryptable: GCM auth-tag verification fails before we ever
 * see plaintext. Recovery = soft-delete the affected telephony_connections
 * rows and have the user re-run the Connect flow; new tokens encrypt under
 * the new key. There is no envelope/key-id format in v1, so rotation is a
 * destructive event today. The `v1:` prefix is the seam where a versioned
 * key-id format can be added later without breaking stored rows.
 *
 * Backup
 * ------
 * The env var IS the backup of decryptability for every stored ciphertext.
 * Treat it like a database backup: lose it and the data is gone.
 *
 * Usage discipline
 * ----------------
 * Decrypt ONLY at point of use (e.g., right before calling the RC API).
 * Never log, never include in audit metadata, never surface in error
 * messages, never cross the server/client boundary. Pino redacts common
 * key names (token/secret/authorization) as a backstop, but the policy is
 * to not pass plaintext into any logger in the first place.
 */

const VERSION = "v1"
const IV_BYTES = 12 // GCM standard nonce size
const TAG_BYTES = 16

function getKey(): Buffer {
  // env.ts has already validated the regex (64 hex chars); Buffer.from
  // tolerates invalid hex silently (returns shorter buffer), so we
  // re-check the length here as a defense-in-depth invariant.
  const key = Buffer.from(env.TELEPHONY_ENCRYPTION_KEY, "hex")
  if (key.length !== 32) {
    throw new Error("TELEPHONY_ENCRYPTION_KEY must decode to exactly 32 bytes")
  }
  return key
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  const payload = Buffer.concat([iv, authTag, ciphertext])
  return `${VERSION}:${payload.toString("base64")}`
}

export function decrypt(blob: string): string {
  const colonIdx = blob.indexOf(":")
  if (colonIdx === -1) {
    throw new Error("ciphertext missing version prefix")
  }
  const version = blob.slice(0, colonIdx)
  if (version !== VERSION) {
    throw new Error(`unsupported ciphertext version: ${version}`)
  }
  const payload = Buffer.from(blob.slice(colonIdx + 1), "base64")
  if (payload.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("ciphertext payload too short")
  }
  const iv = payload.subarray(0, IV_BYTES)
  const authTag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString("utf8")
}
