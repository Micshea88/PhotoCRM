import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { getProvidersByCategory } from "@/modules/integrations/registry"
import type { IntegrationCategory } from "@/modules/integrations/types"
import { ProviderCard } from "./provider-card"

/**
 * Category detail — shows one category's capability description and
 * the providers available under it. Server component; renders the
 * same `ProviderCard` used in the Browse view so the visual contract
 * stays identical.
 *
 * If a future category lands with no providers, the empty-state
 * block tells the user honestly rather than implying breakage.
 */
export function CategoryDetail({ category }: { category: IntegrationCategory }) {
  const providers = getProvidersByCategory(category.id)

  return (
    <div className="space-y-6" data-testid={`integrations-category-${category.id}`}>
      <div>
        <Link
          href="/settings/integrations"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          All integrations
        </Link>
      </div>

      <header>
        <h1 className="font-serif text-xl font-semibold">{category.name}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {category.capabilityDescription}
        </p>
      </header>

      {providers.length === 0 ? (
        <div
          className="rounded-md border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]"
          data-testid={`integrations-category-${category.id}-empty`}
        >
          No providers yet. Check back as we add more.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      )}
    </div>
  )
}
