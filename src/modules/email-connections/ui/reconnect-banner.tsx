"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

/**
 * Task 19 — Reconnect banner.
 *
 * Renders a dismissible attention band at the top of the app shell when the
 * current user has ≥1 expired email connection. Dismissal is session-only
 * (useState; no server persistence) — the banner reappears on next load until
 * the user actually reconnects (which flips status back to "connected" and
 * makes the server-side query return empty).
 *
 * Renders nothing when the expired list is empty OR when the user has
 * dismissed it for this session.
 *
 * Props: a slim projection of EmailConnection — only id and email are needed.
 * Date columns are not included to avoid serialization friction at the
 * server→client boundary.
 */

export interface ExpiredConnectionSummary {
  id: string
  email: string
}

export function ReconnectBanner({
  expiredConnections,
}: {
  expiredConnections: ExpiredConnectionSummary[]
}) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || expiredConnections.length === 0) return null

  const headingText = "Your email connection needs attention"
  const first = expiredConnections[0]
  const bodyText =
    expiredConnections.length === 1 && first
      ? `${first.email} was disconnected by the provider — reconnect to send from your own inbox.`
      : `${String(expiredConnections.length)} email connections need reconnecting.`

  return (
    <div
      role="alert"
      className="mb-4 flex items-center justify-between gap-3 rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/5 px-3 py-2 text-sm"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[var(--color-destructive)]" aria-hidden="true">
          ⚠
        </span>
        <div className="min-w-0">
          <span className="font-medium text-[var(--color-foreground)]">{headingText}</span>
          <span className="ml-2 text-[var(--color-muted-foreground)]">{bodyText}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" asChild>
          <Link href="/settings/integrations">Reconnect</Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDismissed(true)
          }}
          aria-label="Dismiss reconnect banner"
        >
          ✕
        </Button>
      </div>
    </div>
  )
}
