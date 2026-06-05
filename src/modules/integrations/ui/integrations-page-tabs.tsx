import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Browse / Connected Apps tab strip. Server component — mirrors the
 * `CustomFieldsPageTabs` pattern (link-based, ?view=<id> selects the
 * active tab) so the markup + a11y posture are consistent with the
 * rest of /settings.
 *
 * The Connected Apps tab is informational this push (always-empty);
 * the real provider count lands in the next push.
 */
export type IntegrationsTabId = "browse" | "connected"

export interface IntegrationsTabSpec {
  id: IntegrationsTabId
  label: string
}

const TABS: readonly IntegrationsTabSpec[] = [
  { id: "browse", label: "Browse" },
  { id: "connected", label: "Connected apps" },
] as const

export function IntegrationsPageTabs({ active }: { active: IntegrationsTabId }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-[var(--color-border)]">
      {TABS.map((tab) => {
        const isActive = tab.id === active
        return (
          <Link
            key={tab.id}
            role="tab"
            href={`/settings/integrations?view=${tab.id}`}
            aria-selected={isActive}
            data-testid={`integrations-tab-${tab.id}`}
            className={cn(
              "border-b-2 px-4 py-2 text-sm transition-colors",
              isActive
                ? "border-[var(--color-primary)] font-medium text-[var(--color-foreground)]"
                : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
