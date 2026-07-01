"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import type { CategoryId, ConnectKind } from "@/modules/integrations/types"
import { beginRingCentralConnect } from "@/modules/telephony/actions"
import { beginEmailConnect } from "@/modules/email-connections/actions"
import type { EmailProviderChoiceInput } from "@/modules/email-connections/types"

/**
 * Connect / Use-as-dialer / Always-available button.
 *
 * - `oauth` (RingCentral) — calls beginRingCentralConnect server
 *   action. On success, the server sets the PKCE + state cookies and
 *   returns an authorize URL; the browser does a FULL navigation to
 *   leave the app and land at platform.ringcentral.com.
 *
 * - `handoff_only` (Google Voice) — STILL stubbed. The dialer-pref
 *   write lands in a later push.
 *
 * - `none` (tel:) — button rendered disabled. Nothing to set up;
 *   tel: is always available.
 *
 * The action's serverError (e.g. "Only owners and admins can connect
 * integrations...") is surfaced inline as a status message. The
 * client never sees raw error_description from RingCentral — those
 * land in pino on the server side only.
 */
export function ProviderConnectButton({
  providerId,
  providerName,
  categoryId,
  connectKind,
  ctaLabel,
  disabled = false,
}: {
  providerId: string
  providerName: string
  categoryId: CategoryId
  connectKind: ConnectKind
  ctaLabel: string
  disabled?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [stubNotice, setStubNotice] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    if (connectKind === "oauth") {
      startTransition(async () => {
        // Email providers (gmail/microsoft/other) connect a per-photographer
        // mailbox via Nylas hosted auth; every other oauth provider is
        // RingCentral. Both return an authorize URL to navigate to.
        const result =
          categoryId === "email"
            ? await beginEmailConnect({ provider: providerId as EmailProviderChoiceInput })
            : await beginRingCentralConnect({})
        const url = result.data?.authorizeUrl
        if (typeof url === "string" && url.length > 0) {
          window.location.href = url
          return
        }
        const message =
          (typeof result.serverError === "string" && result.serverError) ||
          `Could not start the ${providerName} connect flow. Please try again.`
        setError(message)
      })
      return
    }
    // handoff_only stays stubbed; none never reaches here (button is
    // disabled), but defensively show the same stub notice if it does.
    setStubNotice(true)
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant={connectKind === "oauth" ? "default" : "outline"}
        size="default"
        disabled={disabled || pending}
        onClick={handleClick}
        data-testid={`integrations-provider-${providerId}-cta`}
      >
        {pending ? "Redirecting…" : ctaLabel}
      </Button>
      {error ? (
        <p
          role="alert"
          className="text-xs text-[var(--color-destructive)]"
          data-testid={`integrations-provider-${providerId}-error`}
        >
          {error}
        </p>
      ) : null}
      {stubNotice ? (
        <p
          role="status"
          className="text-xs text-[var(--color-muted-foreground)]"
          data-testid={`integrations-provider-${providerId}-stub-notice`}
        >
          {connectKind === "handoff_only"
            ? `${providerName} dialer hand-off ships in the next push.`
            : `${providerName} requires no setup.`}
        </p>
      ) : null}
    </div>
  )
}
