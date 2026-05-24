import "server-only"
import { and, desc, eq, lt, notExists, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { invitation, member, organization, user } from "@/modules/auth/schema"
import { invitationExtendedRole } from "@/modules/rbac/schema"

export async function getOrganizationById(orgId: string) {
  const [row] = await db.select().from(organization).where(eq(organization.id, orgId)).limit(1)
  return row ?? null
}

export async function getCurrentMember(orgId: string, userId: string) {
  const [row] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function getUserOrganizations(userId: string) {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
}

export async function getOrganizationMembers(orgId: string) {
  return db.query.member.findMany({
    where: (m, { eq }) => eq(m.organizationId, orgId),
    with: {
      user: {
        columns: { id: true, name: true, email: true, image: true },
      },
    },
  })
}

/**
 * Push 2c.6.5 — LEFT JOIN invitation_extended_role so the
 * /settings/organization/members pending list can render the
 * INVITER'S intended extended role (Admin / Manager / Team
 * member / Accountant) instead of the BA-mapped 3-role
 * collapse. Legacy invitations created before 2c.6.4 have no
 * metadata row — `extendedRole` is null in that case; the UI
 * falls back to extendedFromBetterAuth(inv.role) so they still
 * render with a sensible value.
 */
export async function getPendingInvitations(orgId: string) {
  return db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterId: invitation.inviterId,
      extendedRole: invitationExtendedRole.extendedRole,
    })
    .from(invitation)
    .leftJoin(invitationExtendedRole, eq(invitationExtendedRole.invitationId, invitation.id))
    .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")))
}

/**
 * Push 2c.6.10 — incomplete-signup shells visible to the org admin
 * UI on /settings/organization/members. Definition of "incomplete":
 *
 *   1. user.email_verified = false (never completed BA's email
 *      verification round-trip)
 *   2. No row in `member` (never joined any org)
 *   3. Not the current session's user (defensive — admins
 *      shouldn't see their own row here)
 *   4. user.created_at < NOW() - 24h (protects mid-verification
 *      users from being swept by an over-eager admin click)
 *
 * Returns the 50 most recent matching rows. The org-scoping
 * justification: these rows aren't bound to any organization
 * (the user never joined one), so showing them in *every* org
 * admin's view is the wrong shape — but for a single-tenant V1
 * (K&K only) this is acceptable. When multi-tenant lands,
 * gate this further (e.g. only show users created via an invite
 * for this org).
 */
export async function listIncompleteSignups(currentUserId: string) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return db
    .select({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(
      and(
        eq(user.emailVerified, false),
        sql`${user.id} != ${currentUserId}`,
        lt(user.createdAt, cutoff),
        notExists(
          db
            .select({ x: sql`1` })
            .from(member)
            .where(eq(member.userId, user.id)),
        ),
      ),
    )
    .orderBy(desc(user.createdAt))
    .limit(50)
}

/**
 * Push 2c.6.10 — accept-invite page state-resolution helper.
 *
 * Returns shape used by state 5 (BLOCKER): is there a user row at
 * this email that's unverified, lacks membership, and older than
 * 30 minutes (mid-verification grace window)? If yes, the page
 * surfaces the "incomplete signup blocks this email — ask the
 * inviter to reset" UI instead of letting the visitor proceed.
 */
export async function findStaleUserShellByEmail(email: string) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000)
  const [row] = await db
    .select({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(
      and(
        eq(user.email, email),
        eq(user.emailVerified, false),
        lt(user.createdAt, cutoff),
        notExists(
          db
            .select({ x: sql`1` })
            .from(member)
            .where(eq(member.userId, user.id)),
        ),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function getInvitationById(invitationId: string) {
  const result = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(eq(invitation.id, invitationId))
    .limit(1)
  return result[0] ?? null
}
