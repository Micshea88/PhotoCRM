import { withPageOrgContext } from "@/lib/page-org-context"
import { withOrgContext } from "@/lib/org-context"
import { getNotificationPreferences } from "@/modules/notifications/queries"
import { NotificationSettingsPanel } from "@/modules/notifications/ui/notification-settings-panel"

/**
 * /settings/notifications — Notification channel preferences.
 *
 * Server component: resolves session + org context via withPageOrgContext,
 * loads the sparse prefs array (only types that differ from the registry
 * default have a row), and passes it to the client-side panel.
 *
 * No @/db import here — DB access goes through withOrgContext → tx handle.
 */
export default async function NotificationSettingsPage() {
  return withPageOrgContext(async (ctx) => {
    const prefs = await withOrgContext((tx) =>
      getNotificationPreferences(tx, ctx.orgId, ctx.userId),
    )

    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">Notification settings</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          Choose how you&apos;re notified for each type. Opens are tracked on your timeline, not
          sent as notifications.
        </p>
        <div className="mt-6">
          <NotificationSettingsPanel prefs={prefs} />
        </div>
      </main>
    )
  })
}
