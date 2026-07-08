import "server-only"
import { and, desc, eq, exists, lt, notExists, sql } from "drizzle-orm"
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
 *   5. A pending invitation from THIS org (orgId) exists for this
 *      user's email — org-scoping so cross-org orphan signups are
 *      not exposed to unrelated admins. The invitation.status column
 *      defaults to "pending"; we match that literal value.
 *
 * Returns the 50 most recent matching rows, scoped to the given org.
 */
export async function listIncompleteSignups(currentUserId: string, orgId: string) {
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
        exists(
          db
            .select({ x: sql`1` })
            .from(invitation)
            .where(
              and(
                eq(invitation.organizationId, orgId),
                sql`LOWER(${invitation.email}) = LOWER(${user.email})`,
                eq(invitation.status, "pending"),
              ),
            ),
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

/**
 * Push 2c.6.11 — onboarding banner uses this to detect that the
 * just-signed-up user has a pending invitation waiting. Case-
 * insensitive match on email (RFC 5321 local-parts are technically
 * case-sensitive but every mailer treats them as case-insensitive;
 * BA itself lowercases on send + accept).
 *
 * Filters:
 *   - status = 'pending' (canceled/accepted/rejected ignored)
 *   - expires_at > NOW() (expired invites are useless)
 *
 * Returns ALL matching rows ordered newest first so the UI can
 * render a list when the user happens to have multi-org invites
 * pending at the same time.
 */
export async function getPendingInvitationsForEmail(email: string) {
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(
      and(
        sql`LOWER(${invitation.email}) = LOWER(${email})`,
        eq(invitation.status, "pending"),
        sql`${invitation.expiresAt} > NOW()`,
      ),
    )
    .orderBy(desc(invitation.createdAt))
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
