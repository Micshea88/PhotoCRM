import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationById } from "@/modules/org/queries"
import { DangerZone } from "@/modules/org/ui/danger-zone"

export default async function DangerPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  if (member?.role !== "owner") {
    redirect("/settings/organization")
  }

  const org = await getOrganizationById(orgId)
  if (!org) redirect("/onboarding/create-organization")

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Danger zone</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        Irreversible actions for owners only.
      </p>
      <div className="mt-6">
        <DangerZone orgId={org.id} orgName={org.name} />
      </div>
    </main>
  )
}
