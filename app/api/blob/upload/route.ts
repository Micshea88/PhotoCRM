import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { createId } from "@paralleldrive/cuid2"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { audit } from "@/modules/audit/audit"
import { files } from "@/modules/files/schema"

// Allow-list of MIME types accepted on upload. `text/*` and other open globs
// are intentionally NOT included — `text/html` would let a signed-in user
// host phishing pages on `*.public.blob.vercel-storage.com`.
const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
] as const

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

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
        return {
          allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
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
