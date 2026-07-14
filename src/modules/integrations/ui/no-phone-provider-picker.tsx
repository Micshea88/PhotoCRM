"use client"

import { useRouter } from "next/navigation"
import { Modal } from "@/components/ui/modal"
import { getProvidersByCategory } from "@/modules/integrations/registry"
import type { IntegrationProvider } from "@/modules/integrations/types"

/**
 * Contextual popout for the "no phone provider connected" case.
 *
 * Rendered by the contact-card affordances (the Phone icon in
 * action-icon-row, and the "Make a call" button in the activity
 * feed) when the current user has no live phone-category connection.
 * Lists ALL three providers from the Phone category, including the
 * `tel:` pseudo-provider, so the menu is honest about every option
 * the user has — not just the OAuth ones.
 *
 * Pick semantics:
 *   - `tel:` (connectKind="none") — fires tel:`${primaryPhone}`
 *     IMMEDIATELY via window.location.href. No wizard, no OAuth.
 *     If no primaryPhone is available, the option renders but does
 *     nothing on click (it's "always available" but needs a number).
 *   - `ringcentral` / `google_voice` — routes to the provider's
 *     wizard at /settings/integrations/phone/<id>.
 *
 * `onPick` runs BEFORE the navigation/handoff so the parent can
 * close the modal or clear state cleanly.
 */
export function NoPhoneProviderPicker({
  open,
  onClose,
  onPick,
  primaryPhone,
}: {
  open: boolean
  onClose: () => void
  onPick?: (provider: IntegrationProvider) => void
  /**
   * The contact's primary phone, used when `tel:` is picked. Optional
   * because the picker may also fire from contexts without a contact
   * in scope (a future "Make a call" from the global header, for
   * example).
   */
  primaryPhone?: string | null
}) {
  const router = useRouter()
  const phoneProviders = getProvidersByCategory("phone")

  // No `handlePick` named function — react-hooks/immutability flags
  // `window.location.href = ...` inside a named function-body, but
  // accepts it inside an inline event-handler arrow (precedent:
  // src/modules/contacts/ui/selection-banner.tsx:217-219). The pick
  // logic lives directly in the option's onClick below.

  return (
    <Modal open={open} onClose={onClose} title="Pick a phone provider" className="max-w-md">
      <div className="space-y-4" data-testid="no-phone-provider-picker">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Choose how to make calls and send texts. You can change this later in Settings →
          Integrations.
        </p>
        <ul className="space-y-2" role="list">
          {phoneProviders.map((provider) => {
            const isTel = provider.connectKind === "none"
            const telDisabled = isTel && !primaryPhone
            return (
              <li key={provider.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick?.(provider)
                    onClose()
                    if (isTel) {
                      if (primaryPhone) {
                        // Preserves the existing tel: handoff. The
                        // picker is the new top-level affordance; tel:
                        // is the in-picker preservation.
                        window.location.href = `tel:${primaryPhone}`
                      }
                      // No primaryPhone → no-op; button label conveys
                      // the "needs a number" state.
                      return
                    }
                    router.push(`/settings/integrations/${provider.categoryId}/${provider.id}`)
                  }}
                  disabled={telDisabled}
                  data-testid={`no-phone-picker-option-${provider.id}`}
                  className="w-full rounded-md border border-[var(--color-border)] p-3 text-left transition-colors hover:bg-[var(--state-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="block text-sm font-medium">{provider.name}</span>
                  <span className="block text-xs text-[var(--color-muted-foreground)]">
                    {isTel
                      ? telDisabled
                        ? "Your device's dialer — needs a phone number on file."
                        : "Your device's dialer, no setup."
                      : provider.description}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}
