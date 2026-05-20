import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { OrgSwitcher } from "./org-switcher"
import { ThemeToggle } from "./theme-toggle"
import { UserMenu } from "./user-menu"

interface Org {
  id: string
  name: string
  slug: string
}

/**
 * AppTopbar renders the active studio name on the left, plus the
 * studio switcher, theme toggle, and user menu on the right. Per LOC1
 * (US-only product, plain language) the wordmark shows the user's
 * own studio name, not the product name "Pathway."
 *
 * The AI-assistant placeholder is a disabled icon button — the slot
 * is reserved so the topbar layout doesn't shift when the chat panel
 * ships in P4.6. The button is unusable today; aria-label is set to
 * "AI assistant (coming soon)" so a screen reader announces the
 * deferred state.
 */
export function AppTopbar({
  user,
  studioName,
  organizations,
  activeOrgId,
  className,
}: {
  user: { name: string; email: string }
  studioName: string
  organizations: Org[]
  activeOrgId: string
  className?: string
}) {
  return (
    <header className={cn("flex items-center justify-between gap-4 px-4", className)}>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">{studioName}</span>
        <OrgSwitcher organizations={organizations} activeOrgId={activeOrgId} />
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          disabled
          aria-label="AI assistant (coming soon)"
          title="AI assistant — coming soon"
        >
          <Sparkles className="size-4" />
        </Button>
        <ThemeToggle />
        <UserMenu userName={user.name} userEmail={user.email} />
      </div>
    </header>
  )
}
