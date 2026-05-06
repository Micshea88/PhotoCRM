import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { createId } from "@paralleldrive/cuid2"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { env } from "@/lib/env"
import { audit } from "@/modules/audit/audit"
import { files } from "@/modules/files/schema"

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody

  try {
    const result = await handleUpload({
      body,
      request,
      token: env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (_pathname, _clientPayload) => {
        const session = await auth.api.getSession({ headers: await headers() })
        if (!session?.user) throw new Error("UNAUTHENTICATED")
        const activeOrgId = session.session.activeOrganizationId
        if (!activeOrgId) throw new Error("NO_ACTIVE_ORG")
        return {
          allowedContentTypes: ["image/*", "application/pdf", "text/*"],
          maximumSizeInBytes: 25 * 1024 * 1024,
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
        const id = createId()
        await db.insert(files).values({
          id,
          organizationId: payload.organizationId,
          pathname: uploaded.pathname,
          url: uploaded.url,
          contentType: uploaded.contentType,
          sizeBytes: "size" in uploaded && typeof uploaded.size === "number" ? uploaded.size : 0,
          uploadedBy: payload.userId ?? null,
        })
        await audit(
          {
            db,
            organizationId: payload.organizationId,
            actorUserId: payload.userId ?? null,
          },
          "file.uploaded",
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
