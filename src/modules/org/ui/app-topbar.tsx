import { cn } from "@/lib/utils"
import { OrgSwitcher } from "./org-switcher"
import { ThemeToggle } from "./theme-toggle"
import { UserMenu } from "./user-menu"

interface Org {
  id: string
  name: string
  slug: string
}

export function AppTopbar({
  user,
  organizations,
  activeOrgId,
  className,
}: {
  user: { name: string; email: string }
  organizations: Org[]
  activeOrgId: string
  className?: string
}) {
  return (
    <header className={cn("flex items-center justify-between gap-4 px-4", className)}>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">Pathway</span>
        <OrgSwitcher organizations={organizations} activeOrgId={activeOrgId} />
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu userName={user.name} userEmail={user.email} />
      </div>
    </header>
  )
}
