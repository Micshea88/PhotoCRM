import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { NotificationBell } from "@/modules/notifications/ui/notification-bell"
import { UserMenu } from "./user-menu"

interface Org {
  id: string
  name: string
  slug: string
}

/**
 * AppTopbar renders the active studio name (wordmark) on the left, plus the
 * AI-assistant placeholder, notification bell, and account menu on the right.
 * Org switching + create-org live INSIDE the account menu (UserMenu, HubSpot
 * pattern) — not as a standalone header control beside the wordmark. Per LOC1
 * (US-only product, plain language) the wordmark shows the user's own studio
 * name, not the product name "Pathway."
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
  initialUnreadCount = 0,
  className,
}: {
  user: { name: string; email: string }
  studioName: string
  organizations: Org[]
  activeOrgId: string
  initialUnreadCount?: number
  className?: string
}) {
  return (
    <header className={cn("flex items-center justify-between gap-4 px-4", className)}>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">{studioName}</span>
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
        <NotificationBell initialUnreadCount={initialUnreadCount} />
        <UserMenu
          userName={user.name}
          userEmail={user.email}
          organizations={organizations}
          activeOrgId={activeOrgId}
        />
      </div>
    </header>
  )
}
