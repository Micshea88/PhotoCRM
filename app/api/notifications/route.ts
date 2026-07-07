import { headers } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { runWithOrgContext, withOrgContext } from "@/lib/org-context"
import { getCurrentMember } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import {
  listNotifications,
  listArchivedNotifications,
  unreadCount,
} from "@/modules/notifications/queries"

export const dynamic = "force-dynamic"

/**
 * GET /api/notifications
 *
 * Returns live (or archived) notifications for the authenticated user
 * in their active organization, plus the current unread count.
 *
 * Query params:
 *   tab        — "all" | "unread" | "needs_attention" | "archive" (default "all")
 *   types      — comma-separated notification type keys (OR filter)
 *   from       — ISO date string lower bound (inclusive)
 *   to         — ISO date string upper bound (inclusive)
 *   contactId  — filter to this contact
 *   limit      — max rows (default 50)
 *   offset     — pagination offset (default 0)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })
  }
  const userId = session.user.id
  const orgId = session.session.activeOrganizationId
  if (!orgId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 })
  }

  const member = await getCurrentMember(orgId, userId)
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const tentativeRole = extendedFromBetterAuth(member.role as BetterAuthRole)
  const extendedRole =
    (await runWithOrgContext({ orgId, role: tentativeRole, userId }, async () =>
      getExtendedMemberRole(userId),
    )) ?? tentativeRole

  const sp = request.nextUrl.searchParams
  const tab = sp.get("tab") ?? "all"
  const typesRaw = sp.get("types")
  const fromRaw = sp.get("from")
  const toRaw = sp.get("to")
  const contactId = sp.get("contactId") ?? undefined
  const limit = Math.min(Number(sp.get("limit") ?? "50"), 200)
  const offset = Number(sp.get("offset") ?? "0")

  const types = typesRaw ? typesRaw.split(",").filter(Boolean) : undefined
  const from = fromRaw ? new Date(fromRaw) : undefined
  const to = toRaw ? new Date(toRaw) : undefined

  const result = await runWithOrgContext({ orgId, role: extendedRole, userId }, async () =>
    withOrgContext(async (db) => {
      if (tab === "archive") {
        const [notifs, cnt] = await Promise.all([
          listArchivedNotifications(db, orgId, userId, { limit, offset }),
          unreadCount(db, orgId, userId),
        ])
        return { notifications: notifs, unreadCount: cnt }
      }

      const preset =
        tab === "unread"
          ? ("unread" as const)
          : tab === "needs_attention"
            ? ("needs_attention" as const)
            : ("all" as const)

      const [notifs, cnt] = await Promise.all([
        listNotifications(db, orgId, userId, {
          preset,
          types,
          contactId,
          from,
          to,
          limit,
          offset,
        }),
        unreadCount(db, orgId, userId),
      ])
      return { notifications: notifs, unreadCount: cnt }
    }),
  )

  return NextResponse.json(result)
}
