import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"

export default async function DashboardPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  if (!session.session.activeOrganizationId) redirect("/onboarding/create-organization")

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">
        This is your dashboard. Replace this page with your product.
      </p>
    </div>
  )
}
