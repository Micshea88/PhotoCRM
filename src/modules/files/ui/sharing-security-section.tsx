"use client"

import { useEffect, useState, useTransition } from "react"
import { Copy, Lock, RefreshCw, Send, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  SHARE_LINK_EXPIRATION_OPTIONS,
  DEFAULT_SHARE_LINK_EXPIRATION,
  isExpired,
  isLocked,
  lockoutMinutesRemaining,
} from "@/modules/files/share-link-core"
import {
  getFileSharing,
  regenerateSharePasscode,
  resendSharePasscode,
  sendPasscodeToRecipient,
  reactivateShareLink,
  extendShareLink,
  manualUnlockShareLink,
} from "@/modules/files/share-link-actions"

/**
 * "Sharing & Security" section for the file detail page (Commit 3, Phase D).
 *
 * Self-contained: fetches a file's share links + event log via getFileSharing,
 * and exposes passcode (copy/regenerate/resend/send-to-different-email), expiry
 * (reactivate/extend), manual unlock, and the share log. NOT user-reachable
 * until a file-detail page mounts it (no such route in Commit 3).
 */

interface ShareLinkView {
  id: string
  token: string
  passcodePlaintext: string | null
  expiresAt: string | Date | null
  active: boolean
  revokedAt: string | Date | null
  lockedUntil: string | Date | null
  failedPasscodeAttempts: number
  createdAt: string | Date
}
interface ShareEventView {
  id: string
  shareLinkId: string
  eventType: string
  recipientEmail: string | null
  occurredAt: string | Date
}

function asDate(v: string | Date | null): Date | null {
  if (v == null) return null
  return v instanceof Date ? v : new Date(v)
}

function expiryLabel(link: ShareLinkView, now: Date): string {
  if (!link.active || link.revokedAt) return "Revoked"
  const exp = asDate(link.expiresAt)
  if (exp == null) return "Never expires"
  if (isExpired(exp, now)) return "Expired"
  return `Expires ${exp.toLocaleDateString()}`
}

function ShareLinkRow({
  link,
  events,
  onChanged,
}: {
  link: ShareLinkView
  events: ShareEventView[]
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [expiration, setExpiration] = useState<string>(DEFAULT_SHARE_LINK_EXPIRATION)
  const [altEmail, setAltEmail] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const now = new Date()
  const locked = isLocked(asDate(link.lockedUntil), now)
  const expired = !link.active || !!link.revokedAt || isExpired(asDate(link.expiresAt), now)

  function run(fn: () => Promise<{ serverError?: string } | undefined>, ok: string) {
    setNotice(null)
    startTransition(async () => {
      const res = await fn()
      if (res?.serverError) setNotice(res.serverError)
      else {
        setNotice(ok)
        onChanged()
      }
    })
  }

  return (
    <div data-testid="share-link-row" className="bg-card space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-muted-foreground size-4" aria-hidden="true" />
        <span className="text-sm font-medium">{expiryLabel(link, now)}</span>
        {locked ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">
            <Lock className="size-3" aria-hidden="true" />
            Locked {String(lockoutMinutesRemaining(asDate(link.lockedUntil), now))}m
          </span>
        ) : null}
      </div>

      {/* Passcode */}
      {link.passcodePlaintext ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Passcode</span>
          <code className="bg-muted rounded px-2 py-0.5 font-mono">{link.passcodePlaintext}</code>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
            onClick={() => {
              void navigator.clipboard.writeText(link.passcodePlaintext ?? "")
              setNotice("Passcode copied")
            }}
          >
            <Copy className="size-3.5" aria-hidden="true" /> Copy
          </button>
          <button
            type="button"
            disabled={pending}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs disabled:opacity-50"
            onClick={() => {
              run(() => regenerateSharePasscode({ shareLinkId: link.id }), "Passcode regenerated")
            }}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" /> Regenerate
          </button>
        </div>
      ) : null}

      {/* Passcode delivery */}
      {link.passcodePlaintext ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            disabled={pending}
            className="hover:bg-accent inline-flex items-center gap-1 rounded border px-2 py-1 disabled:opacity-50"
            onClick={() => {
              run(() => resendSharePasscode({ shareLinkId: link.id }), "Passcode resent")
            }}
          >
            <Send className="size-3.5" aria-hidden="true" /> Resend
          </button>
          <input
            type="email"
            value={altEmail}
            onChange={(e) => {
              setAltEmail(e.target.value)
            }}
            placeholder="different email…"
            className="rounded border px-2 py-1"
          />
          <button
            type="button"
            disabled={pending || !altEmail}
            className="hover:bg-accent rounded border px-2 py-1 disabled:opacity-50"
            onClick={() => {
              run(
                () => sendPasscodeToRecipient({ shareLinkId: link.id, email: altEmail }),
                "Passcode sent",
              )
            }}
          >
            Send
          </button>
        </div>
      ) : null}

      {/* Expiry controls */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={expiration}
          onChange={(e) => {
            setExpiration(e.target.value)
          }}
          className="rounded border px-2 py-1"
          aria-label="Expiration"
        >
          {SHARE_LINK_EXPIRATION_OPTIONS.filter((o) => o !== "Custom date…").map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {expired ? (
          <button
            type="button"
            disabled={pending}
            className="hover:bg-accent rounded border px-2 py-1 disabled:opacity-50"
            onClick={() => {
              run(
                () =>
                  reactivateShareLink({
                    shareLinkId: link.id,
                    expiration: expiration as (typeof SHARE_LINK_EXPIRATION_OPTIONS)[number],
                  }),
                "Link reactivated",
              )
            }}
          >
            Reactivate
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            className="hover:bg-accent rounded border px-2 py-1 disabled:opacity-50"
            onClick={() => {
              run(
                () =>
                  extendShareLink({
                    shareLinkId: link.id,
                    expiration: expiration as (typeof SHARE_LINK_EXPIRATION_OPTIONS)[number],
                  }),
                "Expiry extended",
              )
            }}
          >
            Extend
          </button>
        )}
        {locked ? (
          <button
            type="button"
            disabled={pending}
            className="hover:bg-accent rounded border px-2 py-1 disabled:opacity-50"
            onClick={() => {
              run(() => manualUnlockShareLink({ shareLinkId: link.id }), "Unlocked")
            }}
          >
            Unlock now
          </button>
        ) : null}
      </div>

      {notice ? <p className="text-muted-foreground text-xs">{notice}</p> : null}

      {/* Share log */}
      {events.length > 0 ? (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer">
            Share log ({String(events.length)})
          </summary>
          <table className="mt-2 w-full text-left">
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className={cn("border-t")}>
                  <td className="py-1 pr-2 font-medium">{ev.eventType.replace(/_/g, " ")}</td>
                  <td className="text-muted-foreground py-1 pr-2">{ev.recipientEmail ?? "—"}</td>
                  <td className="text-muted-foreground py-1">
                    {asDate(ev.occurredAt)?.toLocaleString() ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  )
}

export function SharingSecuritySection({ fileId }: { fileId: string }) {
  const [links, setLinks] = useState<ShareLinkView[]>([])
  const [events, setEvents] = useState<ShareEventView[]>([])
  const [loaded, setLoaded] = useState(false)

  function load() {
    void getFileSharing({ fileId }).then((res) => {
      const data = res.data
      if (data) {
        setLinks(data.links)
        setEvents(data.events)
      }
      setLoaded(true)
    })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])

  if (!loaded) return <p className="text-muted-foreground text-sm">Loading sharing…</p>
  if (links.length === 0)
    return <p className="text-muted-foreground text-sm">This file hasn’t been shared yet.</p>

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Sharing &amp; Security</h3>
      {links.map((link) => (
        <ShareLinkRow
          key={link.id}
          link={link}
          events={events.filter((e) => e.shareLinkId === link.id)}
          onChanged={load}
        />
      ))}
    </section>
  )
}
