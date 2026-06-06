import type { ConnectedProviderRow } from "@/modules/telephony/queries"
import { getProviderById } from "@/modules/integrations/registry"
import type { IntegrationProvider } from "@/modules/integrations/types"
import { ProviderCard } from "./provider-card"

/**
 * Connected Apps view — renders one card per unique connected
 * provider in the org. Server component, no client state.
 *
 * Per the spec ("present integrations ORG-LEVEL"), this dedupes
 * across users: if three team members have each connected
 * RingCentral, the org sees one "RingCentral — Connected" card.
 * Per-user state lives on the provider wizard page (next push will
 * add the per-user detail panel).
 *
 * Providers in the live rows that aren't in the static registry are
 * dropped — defensive guard so a renamed/removed registry id can't
 * crash the page. The connect/disconnect flow can't currently produce
 * such rows; this is forward-compat.
 */
export function ConnectedAppsList({ rows }: { rows: readonly ConnectedProviderRow[] }) {
  // Unique provider ids, preserving first-seen order.
  const seen = new Set<string>()
  const uniqueProviders: IntegrationProvider[] = []
  for (const row of rows) {
    if (seen.has(row.provider)) continue
    seen.add(row.provider)
    const p = getProviderById(row.provider)
    if (!p) continue
    uniqueProviders.push({ ...p, connectState: "connected" })
  }

  if (uniqueProviders.length === 0) {
    // Nothing in the static registry matched — caller normally renders
    // ConnectedAppsEmpty when rows.length === 0, but this is the
    // defensive case where rows exist but none resolved.
    return null
  }

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="integrations-connected-list"
    >
      {uniqueProviders.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} />
      ))}
    </div>
  )
}
