/**
 * Forward-compatible response envelope for the versioned public API (`/api/v1`,
 * policy #10). EVERY v1 response — success or error — is
 * `{ data, error, meta }`, so we can add top-level fields later (pagination
 * cursors, rate-limit info, warnings) WITHOUT breaking existing consumers. Built
 * now so the first real public endpoint (Zapier / API-key access, later) ships
 * on the convention rather than retrofitting it.
 *
 * `data` holds the payload on success (null on error); `error` holds
 * `{ code, message }` on failure (null on success); `meta` is an open bag for
 * cross-cutting info.
 */
export type ApiMeta = Record<string, unknown>

export interface ApiEnvelope<T> {
  data: T | null
  error: { code: string; message: string } | null
  meta: ApiMeta
}

export function apiOk(
  data: unknown,
  init: { status?: number; meta?: ApiMeta; headers?: HeadersInit } = {},
): Response {
  const body: ApiEnvelope<unknown> = { data, error: null, meta: init.meta ?? {} }
  return Response.json(body, { status: init.status ?? 200, headers: init.headers })
}

export function apiError(
  status: number,
  code: string,
  message: string,
  init: { meta?: ApiMeta; headers?: HeadersInit } = {},
): Response {
  const body: ApiEnvelope<null> = { data: null, error: { code, message }, meta: init.meta ?? {} }
  return Response.json(body, { status, headers: init.headers })
}
