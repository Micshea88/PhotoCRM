import "server-only"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { invitation, member, organization } from "@/modules/auth/schema"

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

export async function getPendingInvitations(orgId: string) {
  return db.query.invitation.findMany({
    where: (i, { and, eq }) => and(eq(i.organizationId, orgId), eq(i.status, "pending")),
  })
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
