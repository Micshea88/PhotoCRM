import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"

/**
 * Root entry point. The starter shipped a "Foundation ready" placeholder
 * here; that placeholder is replaced with auth-aware routing:
 *
 *   - signed-in users land on the dashboard (or onboarding if no org)
 *   - signed-out users go to the sign-in screen
 *
 * No anonymous landing page in V1 — the product is a studio CRM, not a
 * public marketing site. A real marketing page can live elsewhere later.
 */
export default async function HomePage() {
  const session = await getSession()
  if (!session?.user) {
    redirect("/sign-in")
  }
  if (!session.session.activeOrganizationId) {
    redirect("/onboarding/create-organization")
  }
  redirect("/dashboard")
}
