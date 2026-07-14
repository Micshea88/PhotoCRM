import { Skeleton } from "@/components/ui/skeleton"
import { PageContainer } from "@/modules/shared/ui/page-container"

/**
 * Route-level loading UI for /contacts/[id]. Content-shaped skeleton
 * matching the 3-column contact-detail layout: a header (back link +
 * title), then left rail (identity + about), center (tabbed panels),
 * and right rail (collapsible section blocks).
 */
export default function ContactDetailLoading() {
  return (
    <PageContainer variant="full" className="space-y-6">
      {/* Header: back breadcrumb + title */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
      </div>

      {/* 3-column grid (matches the lg+ detail grid) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(260px,320px)_minmax(420px,1fr)_minmax(280px,360px)]">
        {/* Left rail: identity card + action row + about */}
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
            <Skeleton className="mx-auto size-16 rounded-full" />
            <Skeleton className="mx-auto h-5 w-36" />
            <Skeleton className="mx-auto h-3 w-28" />
            <div className="flex justify-center gap-2 pt-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="size-9 rounded-md" />
              ))}
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        </div>

        {/* Center: tab strip + content blocks */}
        <div className="space-y-4">
          <div className="flex gap-3 border-b border-[var(--color-border)] pb-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-[var(--color-border)] p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>

        {/* Right rail: collapsible section blocks */}
        <div className="space-y-4 @max-[1160px]/detail:col-span-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-[var(--color-border)] p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
