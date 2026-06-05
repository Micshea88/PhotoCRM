"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  filterProviders,
  getAllCategories,
  getProvidersByCategory,
} from "@/modules/integrations/registry"
import { ProviderCard } from "./provider-card"

/**
 * Browse view — predictive filter across the static registry, with
 * results regrouped by category. Catalog is small (≤ 4 providers
 * today) so the filter runs client-side on every keystroke without a
 * server round-trip.
 *
 * UX consistency: the input mirrors the contacts-list search styling
 * (single text input + icon, no dropdown affordance) — this is a
 * filter, not a selector, so SearchableSelect was the wrong shape.
 */
export function IntegrationsBrowser() {
  const [query, setQuery] = useState("")

  const filteredByCategory = useMemo(() => {
    const filtered = filterProviders(query)
    const filteredIds = new Set(filtered.map((p) => p.id))
    return getAllCategories().map((category) => {
      const providersForCategory = getProvidersByCategory(category.id).filter((p) =>
        filteredIds.has(p.id),
      )
      return { category, providers: providersForCategory }
    })
  }, [query])

  const anyResults = filteredByCategory.some((g) => g.providers.length > 0)

  return (
    <div className="space-y-6" data-testid="integrations-browser">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
          }}
          placeholder="Search integrations..."
          aria-label="Search integrations"
          className="pl-9"
          data-testid="integrations-search-input"
        />
      </div>

      {anyResults ? (
        filteredByCategory.map(({ category, providers }) =>
          providers.length === 0 ? null : (
            <section key={category.id} aria-label={category.name}>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
                  {category.name}
                </h2>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {category.capabilityDescription}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {providers.map((provider) => (
                  <ProviderCard key={provider.id} provider={provider} />
                ))}
              </div>
            </section>
          ),
        )
      ) : (
        <div
          className="rounded-md border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]"
          data-testid="integrations-browser-empty"
        >
          No integrations match &quot;{query}&quot;.
        </div>
      )}
    </div>
  )
}
