# files module

Wires Vercel Blob for file uploads, scoped to organizations and audited.

## Pattern

- **Schema** (`schema.ts`) — `files` table. Soft-delete columns standard. FK
  to organization is `ON DELETE RESTRICT` so accidental org deletion can't
  cascade-orphan blobs.
- **Upload route** (`app/api/blob/upload/route.ts`) — uses Vercel Blob's
  client-upload pattern. The route validates auth and active org via
  Better Auth, then `handleUpload()` generates a short-lived signed token.
  The browser uploads directly to Blob using that token; on completion,
  Blob calls back to our `onUploadCompleted` which writes the metadata
  row + audit log.
- **Browser usage** — see `ui/upload-button.tsx`. Uses `@vercel/blob/client`'s
  `upload()` function.
- **Soft-delete** — `deleteFile` action sets `deletedAt`. The actual blob
  in Vercel Blob storage is removed by the purge cron (Phase 8) after the
  retention window. This means a "deleted" file can be restored from the
  audit log + DB row (until the cron runs). When the cron runs, it calls
  `purgeBlob(url)` which is the only place Blob storage gets `del()`'d.
