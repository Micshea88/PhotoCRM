import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import {
  getCurrentMember,
  getOrganizationMembers,
  getPendingInvitations,
} from "@/modules/org/queries"
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

  const [members, pending] = await Promise.all([
    getOrganizationMembers(orgId),
    getPendingInvitations(orgId),
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
              }))}
            />
          </section>
        </>
      )}
    </main>
  )
}
