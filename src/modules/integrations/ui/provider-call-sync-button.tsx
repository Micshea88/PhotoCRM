"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { bootstrapRcWebhook } from "@/modules/rc-sync/actions"

/**
 * "Enable call sync" affordance — RingCentral only, Owner/admin only.
 *
 * Rendered by ProviderDetail in the connected branch (so it's hidden until RC
 * is connected). One-time bootstrap: clicking creates the account telephony
 * webhook subscription so calls answered on a cell / by Kelly / on a desk
 * phone auto-appear in Pathway. The daily cron renews the subscription
 * silently thereafter.
 *
 * States:
 *   - not enabled  → "Enable call sync" (primary, clickable).
 *   - enabled      → "Call sync enabled" (disabled) + a small "Refresh"
 *                    button to re-bootstrap a subscription that expired or was
 *                    removed RC-side.
 *
 * Feedback is inline (role=status / role=alert) — the locked integrations UI
 * convention (see ProviderConnectButton / ProviderDisconnectButton); this
 * surface has no toast system.
 */
export function ProviderCallSyncButton({
  providerId,
  initialEnabled,
}: {
  providerId: string
  initialEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    setStatus(null)
    startTransition(async () => {
      const result = await bootstrapRcWebhook({})
      if (result.data?.ok === true) {
        setEnabled(true)
        setStatus("Call sync enabled.")
        return
      }
      const message =
        (typeof result.serverError === "string" && result.serverError) ||
        "Could not enable call sync. Please try again."
      setError(message)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {enabled ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="default"
              disabled
              data-testid={`integrations-provider-${providerId}-call-sync-enabled`}
            >
              Call sync enabled
            </Button>
            <button
              type="button"
              onClick={handleClick}
              disabled={pending}
              className="text-xs font-medium text-[var(--color-primary)] hover:underline disabled:opacity-60"
              data-testid={`integrations-provider-${providerId}-call-sync-refresh`}
            >
              {pending ? "Refreshing…" : "Refresh"}
            </button>
          </>
        ) : (
          <Button
            type="button"
            variant="default"
            size="default"
            disabled={pending}
            onClick={handleClick}
            data-testid={`integrations-provider-${providerId}-call-sync-enable`}
          >
            {pending ? "Enabling…" : "Enable call sync"}
          </Button>
        )}
        <span className="text-xs text-[var(--color-muted-foreground)]">
          Logs calls answered on a cell, desk phone, or by a teammate — not just calls placed from
          Pathway.
        </span>
      </div>
      {error ? (
        <p
          role="alert"
          className="text-xs text-[var(--color-destructive)]"
          data-testid={`integrations-provider-${providerId}-call-sync-error`}
        >
          {error}
        </p>
      ) : null}
      {status ? (
        <p
          role="status"
          className="text-xs text-[var(--color-muted-foreground)]"
          data-testid={`integrations-provider-${providerId}-call-sync-status`}
        >
          {status}
        </p>
      ) : null}
    </div>
  )
}
