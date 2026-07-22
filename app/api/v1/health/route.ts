import { apiOk } from "@/lib/api/envelope"

/**
 * `/api/v1/health` — the anchor endpoint that establishes the versioned public-API
 * convention (policy #10): path-versioned under `/api/v1`, responses use the
 * forward-compatible `{ data, error, meta }` envelope. Public + unauthenticated
 * (a liveness probe); it exposes no tenant data. The first real public endpoints
 * (Zapier / API-key access) are added here later, on this same convention.
 */
export function GET() {
  return apiOk({ status: "ok", version: "v1" })
}
