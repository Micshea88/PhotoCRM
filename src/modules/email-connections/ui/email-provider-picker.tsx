"use client"

import { useState, useTransition } from "react"
import { Mail, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import { beginEmailConnect, disconnectEmail } from "@/modules/email-connections/actions"
import { emailProvidersBySurface } from "@/modules/email-connections/providers"

/**
 * Email connect picker (Commit 4 finish — Item 3). Per-user: every photographer
 * connects their OWN mailbox, so this is available to all users.
 *
 * Layout: featured Gmail + Microsoft buttons; an "Other" toggle revealing a row
 * of recognizable providers (iCloud / Yahoo / AOL / Hotmail) plus a generic
 * "All others — any other email server" catch-all. Everything is catalog-driven
 * (src/modules/email-connections/providers.ts).
 *
 * Graceful failure: if a provider's Nylas connector isn't enabled yet, the
 * connect redirect comes back with `?error`, surfaced here as a plain-English
 * banner (passed in via `statusError`) rather than a crash.
 */

const FEATURED = emailProvidersBySurface("featured")
const ICONS = emailProvidersBySurface("icon")
const CATCHALL = emailProvidersBySurface("catchall")

export function EmailProviderPicker({
  connectedEmail,
  statusError,
}: {
  connectedEmail: string | null
  statusError: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(statusError)
  const [otherOpen, setOtherOpen] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  function connect(providerId: string) {
    setError(null)
    startTransition(async () => {
      const res = await beginEmailConnect({ provider: providerId })
      const url = res.data?.authorizeUrl
      if (typeof url === "string" && url.length > 0) {
        window.location.href = url
        return
      }
      setError(
        (typeof res.serverError === "string" && res.serverError) ||
          "Could not start the connection. This provider may not be set up yet — contact your studio admin.",
      )
    })
  }

  function handleDisconnect() {
    setError(null)
    startTransition(async () => {
      const res = await disconnectEmail({})
      if (res.data?.ok === true) {
        setConfirmDisconnect(false)
        window.location.reload()
        return
      }
      setError(
        (typeof res.serverError === "string" && res.serverError) ||
          "Could not disconnect. Please try again.",
      )
    })
  }

  if (connectedEmail) {
    return (
      <div className="space-y-4" data-testid="email-picker-connected">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] p-4">
          <Mail className="size-5 text-[var(--color-muted-foreground)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Your email is connected</p>
            <p className="truncate text-xs text-[var(--color-muted-foreground)]">
              {connectedEmail}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirmDisconnect(true)
            }}
            disabled={pending}
            data-testid="email-picker-disconnect"
          >
            Disconnect
          </Button>
        </div>
        {error ? <p className="text-xs text-[var(--color-destructive)]">{error}</p> : null}
        <ConfirmModal
          open={confirmDisconnect}
          onClose={() => {
            if (!pending) setConfirmDisconnect(false)
          }}
          onConfirm={handleDisconnect}
          title="Disconnect your email?"
          body="Pathway will stop sending your client email from this mailbox and stop logging replies. You can reconnect at any time."
          confirmLabel="Disconnect"
          destructive
          submitting={pending}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5" data-testid="email-picker">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/5 px-3 py-2 text-xs text-[var(--color-destructive)]"
        >
          {error}
        </p>
      ) : null}

      {/* Featured */}
      <div className="flex flex-wrap gap-3">
        {FEATURED.map((p) => (
          <Button
            key={p.id}
            type="button"
            onClick={() => {
              connect(p.id)
            }}
            disabled={pending}
            data-testid={`email-connect-${p.id}`}
          >
            <Mail className="mr-2 size-4" aria-hidden="true" />
            Connect {p.label}
          </Button>
        ))}
      </div>

      {/* Other */}
      <div className="rounded-md border border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => {
            setOtherOpen((v) => !v)
          }}
          aria-expanded={otherOpen}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium"
          data-testid="email-other-toggle"
        >
          {otherOpen ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
          Other email provider
        </button>
        {otherOpen ? (
          <div className="space-y-3 border-t border-[var(--color-border)] p-4">
            <div className="flex flex-wrap gap-2">
              {ICONS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    connect(p.id)
                  }}
                  disabled={pending}
                  data-testid={`email-connect-${p.id}`}
                >
                  <Mail className="mr-1.5 size-3.5" aria-hidden="true" />
                  {p.label}
                </Button>
              ))}
            </div>
            {CATCHALL.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  connect(p.id)
                }}
                disabled={pending}
                data-testid={`email-connect-${p.id}`}
              >
                {p.label}
              </Button>
            ))}
            <p className="text-xs text-[var(--color-muted-foreground)]">
              For other providers, you&apos;ll enter your email — and, if it isn&apos;t detected
              automatically, your mail server&apos;s incoming and outgoing (IMAP/SMTP) settings.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
