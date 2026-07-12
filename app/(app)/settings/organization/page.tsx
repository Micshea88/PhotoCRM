import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { getOrganizationById } from "@/modules/org/queries"
import { OrganizationSettingsForm } from "@/modules/org/ui/organization-settings-form"
import { PageContainer } from "@/modules/shared/ui/page-container"

export default async function OrganizationSettingsPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const org = await getOrganizationById(orgId)
  if (!org) redirect("/onboarding/create-organization")

  return (
    <PageContainer variant="narrow">
      <h1 className="text-2xl font-semibold">Organization</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        Update your organization details.
      </p>
      <div className="mt-6">
        <OrganizationSettingsForm orgId={org.id} defaultName={org.name} />
      </div>
    </PageContainer>
  )
}
