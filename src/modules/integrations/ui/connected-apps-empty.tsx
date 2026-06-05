import Link from "next/link"
import { Plug } from "lucide-react"

/**
 * Empty-state block for the Connected Apps tab.
 *
 * This push always renders the empty state — `getConnectedProviders()`
 * is stubbed to []. The next push replaces this with a real list when
 * `telephony_connections` (and the other future provider tables) is
 * queried at render time.
 */
export function ConnectedAppsEmpty() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-[var(--color-border)] p-10 text-center"
      data-testid="integrations-connected-empty"
    >
      <span
        className="flex size-12 items-center justify-center rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
        aria-hidden="true"
      >
        <Plug className="size-6" />
      </span>
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
          Nothing connected yet
        </h2>
        <p className="mt-1 max-w-md text-sm text-[var(--color-muted-foreground)]">
          Browse the catalog and connect a provider to start making calls, sending texts, or syncing
          your calendar from inside the CRM.
        </p>
      </div>
      <Link
        href="/settings/integrations?view=browse"
        className="text-sm font-medium text-[var(--color-primary)] underline-offset-4 hover:underline"
        data-testid="integrations-connected-empty-cta"
      >
        Browse integrations
      </Link>
    </div>
  )
}
