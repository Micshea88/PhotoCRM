import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { getSession } from "@/modules/auth/session"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session?.user) {
    redirect("/sign-in")
  }
  // App shell (sidebar, topbar, org switcher) lands in Phase 6.
  // For now, this layout just enforces auth; nested routes handle redirects
  // for "no active org" themselves so the onboarding flow can run inside it.
  return <>{children}</>
}
