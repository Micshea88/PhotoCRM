import type { Metadata } from "next"
import { NotificationsPageClient } from "@/modules/notifications/ui/notifications-page-client"

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
      <div className="border-b border-[var(--color-border)] px-6 py-4">
        <h1 className="text-lg font-semibold">Notifications</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <NotificationsPageClient />
      </div>
    </div>
  )
}
