import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { createId } from "@paralleldrive/cuid2"
import { sql } from "drizzle-orm"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { blob } from "@/lib/blob"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { log } from "@/lib/log"
import { audit } from "@/modules/audit/audit"
import { files } from "@/modules/files/schema"
import { checkFileType } from "@/modules/files/file-types"
import { MAX_FILE_BYTES } from "@/modules/email-log/attachment-routing"
import { scanAndResolveFile } from "@/modules/files/scan"
import { logScanStep } from "@/modules/files/scan-diagnostics"

// File types are gated by EXTENSION via checkFileType (decisions 22–23) — RAW /
// design / Office formats have inconsistent MIME types, so the extension is the
// reliable signal. Blob's MIME allow-list is therefore omitted; uploads are
// private (served only through /api/files/[id] with an auth check), and every
// upload is malware-scanned before it can be used (decision 15).

// Pathway Files per-file ceiling — 1 GB (decision 17, matches Cloudmersive
// Basic's scan max), shared with the composer's pre-upload size check. The
// 25 MB direct-email-attach cap is a separate composer-level routing rule.
const MAX_UPLOAD_BYTES = MAX_FILE_BYTES

/**
 * Pathname must be a clean basename (no slashes, no `..`, sane chars).
 * `addRandomSuffix: true` below ensures every upload lands at a unique URL
 * regardless of what the client supplies, so we don't need an org-prefix —
 * but we still reject anything that looks like a path-traversal probe.
 */
function isCleanBasename(pathname: string): boolean {
  if (!pathname || pathname.length > 200) return false
  if (pathname.includes("/") || pathname.includes("\\")) return false
  if (pathname.includes("..")) return false
  return /^[A-Za-z0-9._\- ]+$/.test(pathname)
}

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody
  // [SCAN-DIAG] request id correlates the route-entry / token / completed steps.
  const requestId = crypto.randomUUID()
  await logScanStep("upload_token_requested", {
    requestId,
    metadata: { url: request.url, body },
  })

  try {
    const result = await handleUpload({
      body,
      request,
      token: env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, _clientPayload) => {
        const session = await auth.api.getSession({ headers: await headers() })
        if (!session?.user) throw new Error("UNAUTHENTICATED")
        const activeOrgId = session.session.activeOrganizationId
        if (!activeOrgId) throw new Error("NO_ACTIVE_ORG")
        if (!isCleanBasename(pathname)) {
          throw new Error("INVALID_PATHNAME")
        }
        // Extension whitelist/blacklist (decisions 22–23) — fail fast, before
        // the file is even uploaded.
        if (!checkFileType(pathname).ok) {
          throw new Error("INVALID_FILE_TYPE")
        }
        await logScanStep("upload_token_issued", {
          requestId,
          filename: pathname,
          orgId: activeOrgId,
        })
        return {
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          tokenPayload: JSON.stringify({
            organizationId: activeOrgId,
            userId: session.user.id,
          }),
          addRandomSuffix: true,
        }
      },
      onUploadCompleted: async ({ blob: uploaded, tokenPayload }) => {
        // Parse the org FIRST so the diagnostics row is org-tagged — the admin
        // viewer is org-scoped and must not pool rows across tenants (security
        // review 2026-06-26). This is the earliest point org is known.
        const payload = tokenPayload
          ? (JSON.parse(tokenPayload) as { organizationId?: string; userId?: string })
          : {}
        await logScanStep("upload_completed_callback_fired", {
          requestId,
          orgId: payload.organizationId,
          filename: uploaded.pathname,
          fileSizeBytes:
            "size" in uploaded && typeof uploaded.size === "number" ? uploaded.size : undefined,
          metadata: { blobUrl: uploaded.url },
        })
        if (!payload.organizationId) return
        // Vercel Blob's onUploadCompleted payload does NOT include `size`, so we
        // read it from storage via head() after the upload completes. (The old
        // BLOB_SIZE_MISSING throw fired on every upload because it checked a
        // field Vercel omits here — root cause of the "scan never runs" bug,
        // 2026-06-26.) Defensive fallback to 0 so a head() hiccup records a
        // 0-byte size rather than failing the whole upload.
        let sizeBytes = 0
        try {
          const meta = await blob.head(uploaded.url)
          if (Number.isFinite(meta.size)) {
            sizeBytes = meta.size
          } else {
            log.warn({ url: uploaded.url }, "blob upload: head() returned no size — recording 0")
          }
        } catch (err) {
          log.warn({ err, url: uploaded.url }, "blob upload: head() failed — recording size 0")
        }
        const id = createId()
        // Sessionless callback → the `files` + `audit_log` tables now have FORCE
        // org-isolation RLS. Run the INSERT + audit in a transaction scoped to the
        // org from the verified token payload (SET LOCAL ROLE app_authenticated +
        // app.current_org) so both satisfy their WITH CHECK. The org comes from the
        // signed token, so this cannot write into another tenant.
        const orgId = payload.organizationId
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
          await tx.execute(sql`SELECT set_config('app.current_org', ${orgId}, true)`)
          await tx.insert(files).values({
            id,
            organizationId: orgId,
            pathname: uploaded.pathname,
            url: uploaded.url,
            contentType: uploaded.contentType,
            sizeBytes,
            uploadedBy: payload.userId ?? null,
            // scanStatus defaults to "pending" — resolved by the scan below.
          })
          await audit(
            {
              db: tx,
              organizationId: orgId,
              actorUserId: payload.userId ?? null,
            },
            "files.uploaded",
            { resourceType: "file", resourceId: id, metadata: { url: uploaded.url } },
          )
        })
        // Malware scan (decision 15) — every upload, before the file is usable.
        // Runs here in the async upload-completed callback; the client polls
        // scanStatus. scanAndResolveFile never throws.
        await scanAndResolveFile(db, id, uploaded.url, uploaded.pathname, payload.organizationId)
      },
    })
    return Response.json(result)
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "upload failed" },
      { status: 400 },
    )
  }
}
