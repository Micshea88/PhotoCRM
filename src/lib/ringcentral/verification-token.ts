/**
 * RingCentral webhook authentication helpers.
 *
 * RC webhooks are NOT HMAC-signed. Two distinct tokens are involved:
 *
 *  1. Validation-Token (one-time handshake): when a subscription is created
 *     (or RC re-validates the endpoint), RC sends a `Validation-Token` request
 *     header. The endpoint must echo it back in the response `Validation-Token`
 *     header with a 200 within 3s. `getValidationToken` reads it.
 *
 *  2. Verification Token (per-event auth): a developer-set secret RC includes
 *     as a header on every delivered event. `verifyVerificationToken` checks it
 *     in constant time. This is the only auth on event delivery, so a mismatch
 *     MUST be rejected.
 *
 * Pure + dependency-free (no node:crypto) so it runs in any runtime and unit
 * tests without mocks.
 */

/** RC's validation-token handshake header (case-insensitive in practice; the
 *  Headers API lowercases lookups). */
export const VALIDATION_TOKEN_HEADER = "validation-token"

/** Header carrying the developer-set Verification Token on every event. */
export const VERIFICATION_TOKEN_HEADER = "verification-token"

/**
 * Return the one-time Validation-Token if this request is RC's subscription
 * handshake, else null. The route echoes a non-null value back verbatim.
 */
export function getValidationToken(headers: Headers): string | null {
  return headers.get(VALIDATION_TOKEN_HEADER)
}

/**
 * Constant-time comparison of the received Verification Token against the
 * configured secret. Returns false if either is missing or lengths differ
 * (length is allowed to leak; the secret bytes are not). Never throws.
 */
export function verifyVerificationToken(
  received: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!received || !expected) return false
  if (received.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < received.length; i++) {
    mismatch |= received.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return mismatch === 0
}

/** Convenience: read + verify the per-event token off a request's headers. */
export function isVerifiedWebhookRequest(
  headers: Headers,
  expected: string | null | undefined,
): boolean {
  return verifyVerificationToken(headers.get(VERIFICATION_TOKEN_HEADER), expected)
}
