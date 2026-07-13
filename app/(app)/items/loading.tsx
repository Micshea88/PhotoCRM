import { Skeleton } from "@/components/ui/skeleton"
import { PageContainer } from "@/modules/shared/ui/page-container"

/**
 * Route-level loading UI for /items. Content-shaped skeleton: a header
 * (title + subtitle + action) and ~6 list rows matching the real list.
 */
export default function ItemsLoading() {
  return (
    <PageContainer variant="full" className="space-y-6">
      {/* Header: title + subtitle + action */}
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>

      {/* ~6 rows */}
      <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between p-4">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </PageContainer>
  )
}
