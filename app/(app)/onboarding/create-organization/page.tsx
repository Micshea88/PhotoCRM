import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { CreateOrganizationForm } from "@/modules/org/ui/create-organization-form"

export default async function CreateOrganizationPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  if (session.session.activeOrganizationId) redirect("/dashboard")

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Create your organization</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            One last step before you start using Pathway.
          </p>
        </div>
        <CreateOrganizationForm />
      </div>
    </main>
  )
}
