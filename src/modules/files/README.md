# files module

Wires Vercel Blob for **private** file uploads, scoped to organizations and audited.

## Pattern

- **Schema** (`schema.ts`) — `files` table. Soft-delete columns standard. FK
  to organization is `ON DELETE RESTRICT` so accidental org deletion can't
  cascade-orphan blobs.

- **Upload route** (`app/api/blob/upload/route.ts`) — uses Vercel Blob's
  client-upload pattern with `access: "private"`. The route validates auth
  and active org via Better Auth, then `handleUpload()` generates a
  short-lived signed token. The browser uploads directly to Blob using that
  token; on completion, Blob calls back to `onUploadCompleted` which writes
  the metadata row + audit log.
  - **Pathnames must be a clean basename** — no slashes, no `..`. With
    `addRandomSuffix: true` the actual blob URL is unique and unguessable.

- **Download proxy** (`app/api/files/[id]/route.ts`) — because blobs are
  private, browsers cannot fetch `file.url` directly. They go through this
  proxy, which:
  1. Verifies an active session and active org.
  2. Looks up the file row and confirms it belongs to the active org.
  3. Streams the bytes via `blob.get(url, { access: "private" })`.

  **Always link to `/api/files/<id>` from UI**, never to `file.url`.

- **MIME whitelist** is explicit (no `text/*` glob — `text/html` would
  enable phishing pages on the blob CDN). Edit `ALLOWED_CONTENT_TYPES` in
  the upload route to extend.

- **Soft-delete** — `deleteFile` action sets `deletedAt`. The actual blob in
  Vercel Blob storage is removed by the purge cron after `RETENTION_DAYS`
  (default 90). Until then a "deleted" file can be restored from the audit
  log + DB row. After purge, the blob is gone.

- **Public blobs** — if you genuinely need a public URL (avatars on a
  marketing page), call `blob.put(...)` with `{ access: "public" }`
  explicitly. Default is private to fail safe.

## Adding new file flows

- For an "attach a file to an item" pattern, store `fileId` (the row id)
  next to the item, not `fileUrl`. Display via `<img src="/api/files/{fileId}" />`
  or similar.
- For exports / generated reports, write the bytes server-side via
  `blob.put(pathname, body)` and store the resulting `id`.
