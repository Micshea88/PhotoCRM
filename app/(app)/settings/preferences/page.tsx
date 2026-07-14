import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { getDefaultShareExpiration } from "@/modules/org-preferences/queries"
import { PreferencesForm } from "@/modules/org-preferences/ui/preferences-form"
import { PageContainer } from "@/modules/shared/ui/page-container"

export default async function PreferencesSettingsPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const defaultExpiration = await getDefaultShareExpiration(orgId)

  return (
    <PageContainer variant="narrow">
      <h1 className="font-serif text-2xl font-semibold">Preferences</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        Org-wide defaults for sharing and delivery.
      </p>
      <div className="mt-6">
        <PreferencesForm defaultExpiration={defaultExpiration} />
      </div>
    </PageContainer>
  )
}
