/**
 * Deprecation / sunset headers for versioned API responses (policy #10).
 *
 * - `Sunset` (RFC 8594): the HTTP-date after which the endpoint may stop working.
 * - `Deprecation` (draft-ietf-httpapi-deprecation-header): `"true"` or an
 *   HTTP-date marking when it became deprecated.
 * - `Link; rel="sunset"`: points consumers at the migration/docs page.
 *
 * Built now so that when a `/api/v1` endpoint is eventually superseded, we can
 * signal it to consumers on the standard headers instead of inventing an ad-hoc
 * scheme. Spread the result into a route's response `headers`.
 */
export function deprecationHeaders(opts: {
  /** `true`, or the date it became deprecated. */
  deprecatedAt?: Date | true
  /** The date after which the endpoint may be removed (RFC 8594 Sunset). */
  sunsetAt?: Date
  /** Docs/migration URL surfaced via `Link; rel="sunset"`. */
  infoUrl?: string
}): Record<string, string> {
  const headers: Record<string, string> = {}
  if (opts.deprecatedAt) {
    headers.Deprecation = opts.deprecatedAt === true ? "true" : opts.deprecatedAt.toUTCString()
  }
  if (opts.sunsetAt) {
    headers.Sunset = opts.sunsetAt.toUTCString()
  }
  if (opts.infoUrl) {
    headers.Link = `<${opts.infoUrl}>; rel="sunset"`
  }
  return headers
}
