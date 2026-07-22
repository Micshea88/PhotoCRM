# `/api/v1` — versioned public API

The home for **externally-consumed** endpoints (third-party integrations, Zapier,
API-key access). Internal surfaces — auth, webhooks, cron/queue jobs, blob/files,
share-link — are NOT here and are NOT versioned; they're implementation detail.

Established now (policy #10) so the first public endpoint ships on the convention
rather than retrofitting it. Today only `health/` exists as the anchor.

## Conventions

1. **Path versioning.** Public endpoints live under `/api/v1/...`. A breaking
   change means a new `/api/v2`, not mutating v1 in place.
2. **Response envelope** (`@/lib/api/envelope`). Every response — success and
   error — is `{ data, error, meta }`:
   - success → `apiOk(payload, { meta? })` → `{ data: payload, error: null, meta }`
   - failure → `apiError(status, code, message)` → `{ data: null, error: { code, message }, meta }`

   `meta` is an open bag so we can add cross-cutting fields (pagination cursors,
   rate-limit info, warnings) WITHOUT breaking consumers.

3. **Deprecation / sunset** (`@/lib/api/deprecation`). When an endpoint is
   superseded, spread `deprecationHeaders({ deprecatedAt, sunsetAt, infoUrl })`
   into the response `headers` — `Sunset` (RFC 8594) + `Deprecation` + a
   `Link; rel="sunset"` to the migration docs.
4. **Auth (later).** Public endpoints will authenticate via API keys (not the
   session cookie). The API-key layer + shared Upstash rate-limit are their own
   builds (see `docs/pre-events-punchlist.md`); until then, only unauthenticated,
   no-tenant-data endpoints (like `health`) belong here.

## Adding an endpoint

```ts
// app/api/v1/<name>/route.ts
import { apiOk, apiError } from "@/lib/api/envelope"

export async function GET() {
  // ...resolve/authorize (API key), fetch via a module's queries.ts...
  return apiOk(payload)
}
```
