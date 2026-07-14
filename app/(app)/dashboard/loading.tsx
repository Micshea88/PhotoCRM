import { Skeleton } from "@/components/ui/skeleton"
import { PageContainer } from "@/modules/shared/ui/page-container"

/**
 * Route-level loading UI for /dashboard. Content-shaped skeleton: a
 * welcome header, a row of three count cards, and two larger widget
 * blocks (Team This Week + Tasks due this week).
 */
export default function DashboardLoading() {
  return (
    <PageContainer variant="full" className="space-y-6">
      {/* Welcome header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Three count cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-12" />
          </div>
        ))}
      </div>

      {/* Two widget blocks */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 3 }).map((_, j) => (
            <div key={j} className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ))}
    </PageContainer>
  )
}
