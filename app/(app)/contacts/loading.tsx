import { Skeleton } from "@/components/ui/skeleton"
import { PageContainer } from "@/modules/shared/ui/page-container"

/**
 * Route-level loading UI for /contacts. Content-shaped skeleton: a header
 * bar + search field, then a list card with a toolbar row and ~8 table
 * rows (avatar circle + two text lines + a status pill).
 */
export default function ContactsLoading() {
  return (
    <PageContainer variant="full" className="space-y-6">
      {/* Header: title + actions */}
      <div className="flex items-start justify-between gap-4">
        <Skeleton className="h-8 w-40" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Search bar */}
      <Skeleton className="h-9 w-full max-w-sm" />

      {/* List card */}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
        {/* Toolbar row */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
          <div className="flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>

        {/* ~8 rows */}
        <div className="divide-y divide-[var(--color-border)]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
