import "server-only"
import { put, del, list, type PutBlobResult } from "@vercel/blob"
import { env } from "@/lib/env"

export const blob = {
  put: async (
    pathname: string,
    body: Buffer | Blob | ReadableStream | string,
    opts?: { contentType?: string },
  ): Promise<PutBlobResult> =>
    put(pathname, body, {
      access: "public",
      token: env.BLOB_READ_WRITE_TOKEN,
      contentType: opts?.contentType,
    }),
  del: (urlOrUrls: string | string[]) => del(urlOrUrls, { token: env.BLOB_READ_WRITE_TOKEN }),
  list: (opts?: Parameters<typeof list>[0]) => list({ ...opts, token: env.BLOB_READ_WRITE_TOKEN }),
}
