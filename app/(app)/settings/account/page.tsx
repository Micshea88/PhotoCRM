import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { AccountSettingsForm } from "@/modules/auth/ui/account-settings-form"
import { PageContainer } from "@/modules/shared/ui/page-container"

export default async function AccountSettingsPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")

  return (
    <PageContainer variant="narrow">
      <h1 className="text-2xl font-semibold">Account</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        Update your name, email, and password.
      </p>
      <div className="mt-6">
        <AccountSettingsForm defaultName={session.user.name} defaultEmail={session.user.email} />
      </div>
    </PageContainer>
  )
}
