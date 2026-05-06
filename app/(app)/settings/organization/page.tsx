import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { db } from "@/lib/db"
import { OrganizationSettingsForm } from "@/modules/org/ui/organization-settings-form"

export default async function OrganizationSettingsPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const org = await db.query.organization.findFirst({
    where: (o, { eq }) => eq(o.id, orgId),
  })
  if (!org) redirect("/onboarding/create-organization")

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Organization</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        Update your organization details.
      </p>
      <div className="mt-6">
        <OrganizationSettingsForm orgId={org.id} defaultName={org.name} />
      </div>
    </main>
  )
}
