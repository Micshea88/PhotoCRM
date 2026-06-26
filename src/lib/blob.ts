import "server-only"
import { put, del, get, list, head, type PutBlobResult } from "@vercel/blob"
import { env } from "@/lib/env"

/**
 * Vercel Blob wrapper. Defaults to `access: "private"` — uploaded files are
 * NOT publicly accessible by URL. To serve a private blob to a browser, the
 * server must call `blob.get(url, { access: "private" })` and stream the
 * response (see `app/api/files/[id]/route.ts` for the canonical pattern).
 *
 * If you need a public URL (e.g. avatars on a marketing page), call `put`
 * with `{ access: "public" }` explicitly. Default is private to fail safe.
 */
export const blob = {
  put: async (
    pathname: string,
    body: Buffer | Blob | ReadableStream | string,
    opts?: { contentType?: string; access?: "public" | "private" },
  ): Promise<PutBlobResult> =>
    put(pathname, body, {
      access: opts?.access ?? "private",
      token: env.BLOB_READ_WRITE_TOKEN,
      contentType: opts?.contentType,
    }),
  del: (urlOrUrls: string | string[]) => del(urlOrUrls, { token: env.BLOB_READ_WRITE_TOKEN }),
  /** Fetch a private blob for server-side proxying. Returns null on 404. */
  get: (url: string) => get(url, { access: "private", token: env.BLOB_READ_WRITE_TOKEN }),
  /** Blob metadata (size, contentType, …) — the onUploadCompleted callback
   *  payload omits `size`, so we read it from storage here instead. */
  head: (url: string) => head(url, { token: env.BLOB_READ_WRITE_TOKEN }),
  list: (opts?: Parameters<typeof list>[0]) => list({ ...opts, token: env.BLOB_READ_WRITE_TOKEN }),
}
