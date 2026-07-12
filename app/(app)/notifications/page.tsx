import type { Metadata } from "next"
import { NotificationsPageClient } from "@/modules/notifications/ui/notifications-page-client"
import { PageContainer } from "@/modules/shared/ui/page-container"

export const metadata: Metadata = {
  title: "Notifications",
}

/**
 * Full notifications page — server component wrapper; all data-fetching
 * happens client-side via the same /api/notifications route used by the
 * dropdown, so the page is lightweight and SSR-friendly.
 */
export default function NotificationsPage() {
  return (
    <div className="flex h-full flex-col">
      {/* Full-bleed header border; PageContainer gives the title the standard
          horizontal gutter (LAW 6 — no page-owned px). */}
      <div className="border-b border-[var(--color-border)] py-4">
        <PageContainer variant="full">
          <h1 className="text-lg font-semibold">Notifications</h1>
        </PageContainer>
      </div>
      <div className="flex-1 overflow-y-auto py-6">
        <PageContainer variant="full">
          <NotificationsPageClient />
        </PageContainer>
      </div>
    </div>
  )
}
