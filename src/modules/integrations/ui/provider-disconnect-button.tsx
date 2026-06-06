"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import { disconnectTelephony } from "@/modules/telephony/actions"

/**
 * Disconnect affordance — Owner/admin only.
 *
 * Rendered by ProviderDetail when the provider is currently
 * connected. Opens a ConfirmModal; on confirm, calls the
 * disconnectTelephony server action which soft-deletes the
 * (org, user, provider) row. The action's revalidatePath causes
 * the wizard to re-render in the Not-connected state.
 *
 * Errors from the server action (e.g. role changed mid-flow,
 * row already deleted) surface as an inline status message.
 */
export function ProviderDisconnectButton({
  providerId,
  providerName,
}: {
  providerId: string
  providerName: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await disconnectTelephony({ provider: providerId })
      if (result.data?.ok === true) {
        setOpen(false)
        return
      }
      const message =
        (typeof result.serverError === "string" && result.serverError) ||
        `Could not disconnect ${providerName}. Please try again.`
      setError(message)
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true)
        }}
        data-testid={`integrations-provider-${providerId}-disconnect`}
      >
        Disconnect
      </Button>
      {error ? (
        <p
          role="alert"
          className="text-xs text-[var(--color-destructive)]"
          data-testid={`integrations-provider-${providerId}-disconnect-error`}
        >
          {error}
        </p>
      ) : null}
      <ConfirmModal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false)
        }}
        onConfirm={handleConfirm}
        title={`Disconnect ${providerName}?`}
        body={`${providerName} will stop being available for calls and SMS. You can reconnect at any time.`}
        confirmLabel="Disconnect"
        destructive
        submitting={pending}
      />
    </>
  )
}
