import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Tab strip for /settings/custom-fields. Server Component — receives
 * already-resolved entity labels (terminology-aware plurals like
 * "Contacts" / "Companies" / "Pipeline" / "Events") from the route
 * and renders one tab per entry. Active tab is determined by the
 * `recordType` query string read in the route handler.
 *
 * Plurals come from the terminology module — DO NOT hardcode "Events"
 * or "Pipeline" in this file. The route resolves them via getLabel()
 * and passes them in as `tabs[i].label`.
 */
export interface CustomFieldsTabSpec {
  recordType: string
  label: string
}

export function CustomFieldsPageTabs({
  tabs,
  active,
}: {
  tabs: readonly CustomFieldsTabSpec[]
  active: string
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-[var(--color-border)]">
      {tabs.map((tab) => {
        const isActive = tab.recordType === active
        return (
          <Link
            key={tab.recordType}
            role="tab"
            href={`/settings/custom-fields?type=${tab.recordType}`}
            aria-selected={isActive}
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
