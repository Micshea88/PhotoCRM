import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { createId } from "@paralleldrive/cuid2"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { audit } from "@/modules/audit/audit"
import { files } from "@/modules/files/schema"
import { checkFileType } from "@/modules/files/file-types"
import { scanAndResolveFile } from "@/modules/files/scan"

// File types are gated by EXTENSION via checkFileType (decisions 22–23) — RAW /
// design / Office formats have inconsistent MIME types, so the extension is the
// reliable signal. Blob's MIME allow-list is therefore omitted; uploads are
// private (served only through /api/files/[id] with an auth check), and every
// upload is malware-scanned before it can be used (decision 15).

// Pathway Files per-file ceiling — 1 GB (decision 17, matches Cloudmersive
// Basic's scan max). The 25 MB direct-email-attach cap is a separate
// composer-level check (decision 18).
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024

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
        const payload = tokenPayload
          ? (JSON.parse(tokenPayload) as { organizationId?: string; userId?: string })
          : {}
        if (!payload.organizationId) return
        // size MUST be present — Vercel always includes it. If it isn't, fail
        // loudly rather than silently writing a 0-byte row that breaks quotas
        // and billing displays downstream.
        if (!("size" in uploaded) || typeof uploaded.size !== "number") {
          throw new Error("BLOB_SIZE_MISSING")
        }
        const id = createId()
        await db.insert(files).values({
          id,
          organizationId: payload.organizationId,
          pathname: uploaded.pathname,
          url: uploaded.url,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.size,
          uploadedBy: payload.userId ?? null,
          // scanStatus defaults to "pending" — resolved by the scan below.
        })
        await audit(
          {
            db,
            organizationId: payload.organizationId,
            actorUserId: payload.userId ?? null,
          },
          "files.uploaded",
          { resourceType: "file", resourceId: id, metadata: { url: uploaded.url } },
        )
        // Malware scan (decision 15) — every upload, before the file is usable.
        // Runs here in the async upload-completed callback; the client polls
        // scanStatus. scanAndResolveFile never throws.
        await scanAndResolveFile(db, id, uploaded.url, uploaded.pathname)
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
