"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { ConnectKind } from "@/modules/integrations/types"

/**
 * Connect / Use-as-dialer / Always-available button — STUB this push.
 *
 * The actual handoff (OAuth redirect for `oauth`, dialer-pref write
 * for `handoff_only`) lands in the next push. Today, clicking the
 * button reveals an inline "Connect flow ships in the next push"
 * notice so the user can see the affordance is real but the wiring
 * is pending.
 *
 * `none` providers (e.g., `tel:`) render the button as disabled —
 * there is no real "connect" action.
 */
export function ProviderConnectButton({
  providerId,
  providerName,
  connectKind,
  ctaLabel,
  disabled = false,
}: {
  providerId: string
  providerName: string
  connectKind: ConnectKind
  ctaLabel: string
  disabled?: boolean
}) {
  const [showStub, setShowStub] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant={connectKind === "oauth" ? "default" : "outline"}
        size="default"
        disabled={disabled}
        onClick={() => {
          setShowStub(true)
        }}
        data-testid={`integrations-provider-${providerId}-cta`}
      >
        {ctaLabel}
      </Button>
      {showStub ? (
        <p
          role="status"
          className="text-xs text-[var(--color-muted-foreground)]"
          data-testid={`integrations-provider-${providerId}-stub-notice`}
        >
          {connectKind === "oauth"
            ? `${providerName} OAuth flow ships in the next push.`
            : connectKind === "handoff_only"
              ? `${providerName} dialer hand-off ships in the next push.`
              : `${providerName} requires no setup.`}
        </p>
      ) : null}
    </div>
  )
}
