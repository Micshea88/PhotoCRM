import { redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import {
  getCurrentMember,
  getOrganizationMembers,
  getPendingInvitations,
} from "@/modules/org/queries"
import { listExtendedRolesByUserId } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { InviteMemberForm } from "@/modules/org/ui/invite-member-form"
import { MembersList } from "@/modules/org/ui/members-list"
import { PendingInvitations } from "@/modules/org/ui/pending-invitations"
import { Separator } from "@/components/ui/separator"

export default async function OrgMembersPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const currentMember = await getCurrentMember(orgId, session.user.id)
  if (!currentMember) redirect("/dashboard")
  const currentBaRole = currentMember.role as BetterAuthRole

  const [members, pending, extendedRoles] = await Promise.all([
    getOrganizationMembers(orgId),
    getPendingInvitations(orgId),
    runWithOrgContext(
      { orgId, role: extendedFromBetterAuth(currentBaRole), userId: session.user.id },
      () => listExtendedRolesByUserId(),
    ),
  ])

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Members</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        Invite, manage, and remove members of your organization.
      </p>

      {(currentMember.role === "owner" || currentMember.role === "admin") && (
        <section className="mt-6 space-y-3">
          <h2 className="text-base font-medium">Invite a member</h2>
          <InviteMemberForm />
        </section>
      )}

      <Separator className="my-8" />

      <section className="space-y-3">
        <h2 className="text-base font-medium">Active members</h2>
        <MembersList
          members={members.map((m) => ({
            id: m.id,
            role: m.role,
            // Push 2c.5 — extended role from memberRole, falling back
            // to the BA-mapped default for members without a row.
            extendedRole:
              extendedRoles.get(m.user.id) ?? extendedFromBetterAuth(m.role as BetterAuthRole),
            user: {
              id: m.user.id,
              name: m.user.name,
              email: m.user.email,
            },
          }))}
          currentUserId={session.user.id}
          currentUserRole={currentMember.role}
        />
      </section>

      {pending.length > 0 && (
        <>
          <Separator className="my-8" />
          <section className="space-y-3">
            <h2 className="text-base font-medium">Pending invitations</h2>
            <PendingInvitations
              invitations={pending.map((i) => ({
                id: i.id,
                email: i.email,
                role: i.role ?? "member",
                // Push 2c.6.5 — null for legacy invitations created
                // before the invitation_extended_role table existed;
                // the UI falls back to extendedFromBetterAuth(i.role)
                // so they still render with a sensible value.
                extendedRole: i.extendedRole,
              }))}
            />
          </section>
        </>
      )}
    </main>
  )
}
