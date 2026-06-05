"use client"

import { useRouter } from "next/navigation"
import { Modal } from "@/components/ui/modal"
import { getProvidersByCategory } from "@/modules/integrations/registry"
import type { IntegrationProvider } from "@/modules/integrations/types"

/**
 * Contextual popout for the "no phone provider connected yet" case.
 *
 * STANDALONE this push — exported but NOT wired into any contact-card
 * affordance. The next push (the one that queries
 * `telephony_connections`) will conditionally open this from the
 * Call/SMS Log buttons in the contact's More menu when zero live
 * connections exist for the user. The existing tel: behavior on the
 * Phone icon itself is preserved unchanged.
 *
 * Renders the Phone category's providers from the SAME registry the
 * Integrations Hub uses, so the user sees the identical set of
 * options no matter where they land.
 *
 * `onPick` is optional — when provided, called BEFORE the navigation
 * (the parent can do e.g., setOpen(false) cleanup). When omitted, we
 * just route to the wizard.
 */
export function NoPhoneProviderPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick?: (provider: IntegrationProvider) => void
}) {
  const router = useRouter()
  const phoneProviders = getProvidersByCategory("phone")

  function handlePick(provider: IntegrationProvider) {
    onPick?.(provider)
    onClose()
    router.push(`/settings/integrations/${provider.categoryId}/${provider.id}`)
  }

  return (
    <Modal open={open} onClose={onClose} title="No phone provider connected" className="max-w-md">
      <div className="space-y-4" data-testid="no-phone-provider-picker">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Pick a phone provider to enable calling and SMS for this workspace. You can change this
          later in Settings → Integrations.
        </p>
        <ul className="space-y-2" role="list">
          {phoneProviders.map((provider) => (
            <li key={provider.id}>
              <button
                type="button"
                onClick={() => {
                  handlePick(provider)
                }}
                data-testid={`no-phone-picker-option-${provider.id}`}
                className="w-full rounded-md border border-[var(--color-border)] p-3 text-left transition-colors hover:bg-[var(--color-accent)]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <span className="block text-sm font-medium">{provider.name}</span>
                <span className="block text-xs text-[var(--color-muted-foreground)]">
                  {provider.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
