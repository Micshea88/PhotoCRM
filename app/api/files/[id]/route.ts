import { headers } from "next/headers"
import { and, eq, isNull, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { blob } from "@/lib/blob"
import { files } from "@/modules/files/schema"

/**
 * Authenticated download proxy for private blobs.
 *
 * Why this exists: blobs are stored with `access: "private"` (see
 * `src/lib/blob.ts`), so the URL returned by `put` is NOT publicly fetchable.
 * Browsers must come through this route, which:
 *   1. Verifies the user has an active session and active org.
 *   2. Looks up the file row and verifies it belongs to the user's org.
 *   3. Streams the blob bytes back via `blob.get(url, { access: "private" })`.
 *
 * NEVER expose `file.url` directly to end-user UI — always link to
 * `/api/files/<id>` so that this re-check runs.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return new Response("Unauthorized", { status: 401 })
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) return new Response("No active organization", { status: 403 })

  // `files` now has FORCE org-isolation RLS. Read inside a tx scoped to the
  // session's active org (SET LOCAL ROLE app_authenticated + app.current_org) so
  // RLS enforces too — belt-and-suspenders alongside the explicit org filter.
  const [row] = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`)
    await tx.execute(sql`SELECT set_config('app.current_org', ${activeOrgId}, true)`)
    return tx
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.organizationId, activeOrgId), isNull(files.deletedAt)))
      .limit(1)
  })
  if (!row) return new Response("Not found", { status: 404 })

  const result = await blob.get(row.url)
  if (result?.statusCode !== 200) {
    return new Response("Not found", { status: 404 })
  }

  return new Response(result.stream, {
    headers: {
      "content-type": row.contentType,
      "content-length": String(row.sizeBytes),
      "cache-control": "private, max-age=300",
    },
  })
}
