"use client"

import { useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmModal } from "@/components/ui/confirm-modal"
import { Input } from "@/components/ui/input"
import {
  ActivityModalChrome,
  AssociationsSection,
  ContactPill,
  FollowUpTaskAffordance,
} from "@/components/ui/activity-modal-chrome"
import { logEmail } from "@/modules/email-log/actions"

/**
 * Push 3 (C6c polish #4) — chrome-only placeholder modals for the
 * activity types whose backend modules haven't shipped yet.
 *
 * Each modal renders the locked HubSpot chrome (collapse / title /
 * grip / expand / close) + a ship-target body + the standard
 * AssociationsSection + FollowUpTaskAffordance. Per the
 * "Everything intentional" rule the surface looks complete now;
 * when the underlying module (email / SMS / events / files) ships,
 * the body block + Create wiring replace the placeholder. No chrome
 * rework.
 */

function PlaceholderModal({
  open,
  onClose,
  contactId,
  contactLabel,
  title,
  shipText,
  bodyHint,
  fields,
  withFollowUp = true,
  withAssociations = true,
}: {
  open: boolean
  onClose: () => void
  contactId: string
  contactLabel: string
  title: string
  /** "Ships in Push X" line surfaced at the top of the body. */
  shipText: string
  /** Short description of what the modal will collect when wired. */
  bodyHint: string
  /** Per-field shells (label + placeholder input). Visual only. */
  fields: ReactNode
  withFollowUp?: boolean
  withAssociations?: boolean
}) {
  return (
    <ActivityModalChrome
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="text-2xs flex items-center justify-between gap-2">
          <span className="text-[var(--color-muted-foreground)]">{shipText}</span>
          <Button type="button" onClick={onClose} variant="outline">
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          For: <ContactPill contactId={contactId} label={contactLabel} />
        </p>
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-2 text-xs">
          <span className="font-medium">{shipText}</span>{" "}
          <span className="text-[var(--color-muted-foreground)]">{bodyHint}</span>
        </p>
        {fields}
        {withAssociations && (
          <AssociationsSection contactId={contactId} contactLabel={contactLabel} />
        )}
        {withFollowUp && <FollowUpTaskAffordance />}
      </div>
    </ActivityModalChrome>
  )
}

function DisabledField({
  label,
  placeholder,
  area = false,
}: {
  label: string
  placeholder: string
  area?: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</label>
      {area ? (
        <textarea
          disabled
          rows={3}
          placeholder={placeholder}
          className="w-full cursor-not-allowed rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm opacity-60 shadow-sm"
        />
      ) : (
        <input
          disabled
          placeholder={placeholder}
          className="w-full cursor-not-allowed rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm opacity-60 shadow-sm"
        />
      )}
    </div>
  )
}

function nowDatetimeLocal(): string {
  // datetime-local needs "YYYY-MM-DDTHH:MM" without seconds or TZ.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const y = String(d.getFullYear())
  const mo = pad(d.getMonth() + 1)
  const da = pad(d.getDate())
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  return `${y}-${mo}-${da}T${hh}:${mm}`
}

/**
 * P-email-log — functional Log email modal (action-icon-row entry
 * point). Was a placeholder until email_log shipped in 0040; now
 * routes through logEmail just like the Activities tab's
 * EmailLogComposer. Keeps the same prop signature so action-icon-row
 * doesn't need to change.
 *
 * Direction defaults to "outbound"; source is "manual"; the action
 * busts the AI cache atomically + audit() + revalidatePath().
 */
export function LogEmailModal({
  open,
  onClose,
  contactId,
  contactLabel,
  fromLabel,
}: {
  open: boolean
  onClose: () => void
  contactId: string
  contactLabel: string
  /** Current user's name/email — surfaced as the From field. */
  fromLabel: string
}) {
  const router = useRouter()
  const [when, setWhen] = useState(nowDatetimeLocal())
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // P-email-log — Item 1 ConfirmModal primitive replaces the native
  // window.confirm("Discard…") so the discard prompt matches the rest
  // of the app's modal styling. onBeforeClose toggles this open and
  // blocks the close; the ConfirmModal's Discard handler force-closes
  // the parent by calling handleClose() directly (bypassing the
  // onBeforeClose gate).
  const [discardOpen, setDiscardOpen] = useState(false)
  const [, startTransition] = useTransition()

  function reset() {
    setWhen(nowDatetimeLocal())
    setSubject("")
    setBody("")
    setError(null)
  }

  function hasUnsavedChanges(): boolean {
    return subject.trim().length > 0 || body.trim().length > 0
  }

  function handleClose() {
    if (busy) return
    reset()
    onClose()
  }

  function confirmDiscard() {
    setDiscardOpen(false)
    handleClose()
  }

  async function submit() {
    if (busy) return
    const trimmedSubject = subject.trim()
    const trimmedBody = body.trim()
    if (trimmedSubject.length === 0 && trimmedBody.length === 0) {
      setError("Enter a subject or body.")
      return
    }
    setBusy(true)
    setError(null)
    const result = await logEmail({
      contactId,
      sentAt: new Date(when).toISOString(),
      direction: "outbound",
      subject: trimmedSubject.length > 0 ? trimmedSubject : null,
      body: trimmedBody.length > 0 ? trimmedBody : null,
    })
    setBusy(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    handleClose()
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <>
      <ActivityModalChrome
        open={open}
        onClose={handleClose}
        title="Log email"
        onBeforeClose={() => {
          if (!hasUnsavedChanges()) return true
          setDiscardOpen(true)
          return false
        }}
        footer={
          <div className="text-2xs flex items-center justify-between gap-2">
            {error ? (
              <span className="text-[var(--color-destructive)]">{error}</span>
            ) : (
              <span className="text-[var(--color-muted-foreground)]">
                Saved to this contact&apos;s activity feed.
              </span>
            )}
            <Button
              type="button"
              onClick={() => {
                void submit()
              }}
              disabled={busy}
              data-testid="log-email-submit"
            >
              {busy ? "Saving…" : "Create"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-[var(--color-muted-foreground)]">
            For: <ContactPill contactId={contactId} label={contactLabel} />
          </p>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-muted-foreground)]">From</label>
            <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
              {fromLabel}
            </p>
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-[var(--color-muted-foreground)]"
              htmlFor="log-email-when"
            >
              When
            </label>
            <Input
              id="log-email-when"
              type="datetime-local"
              value={when}
              onChange={(e) => {
                setWhen(e.target.value)
              }}
              disabled={busy}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-[var(--color-muted-foreground)]"
              htmlFor="log-email-subject"
            >
              Subject
            </label>
            <Input
              id="log-email-subject"
              type="text"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value)
              }}
              disabled={busy}
              placeholder="Subject line"
              data-testid="log-email-subject"
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-[var(--color-muted-foreground)]"
              htmlFor="log-email-body"
            >
              Body
            </label>
            <textarea
              id="log-email-body"
              value={body}
              onChange={(e) => {
                setBody(e.target.value)
              }}
              rows={4}
              maxLength={50_000}
              disabled={busy}
              placeholder="Type the email body"
              data-testid="log-email-body"
              className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none disabled:opacity-50"
            />
          </div>
          <AssociationsSection contactId={contactId} contactLabel={contactLabel} />
          <FollowUpTaskAffordance />
        </div>
      </ActivityModalChrome>
      <ConfirmModal
        open={discardOpen}
        onClose={() => {
          setDiscardOpen(false)
        }}
        onConfirm={confirmDiscard}
        title="Discard this email log?"
        body="The subject and body you've entered will be lost."
        confirmLabel="Discard"
        destructive
      />
    </>
  )
}

export function LogMeetingModal({
  open,
  onClose,
  contactId,
  contactLabel,
}: {
  open: boolean
  onClose: () => void
  contactId: string
  contactLabel: string
}) {
  return (
    <PlaceholderModal
      open={open}
      onClose={onClose}
      contactId={contactId}
      contactLabel={contactLabel}
      title="Log meeting"
      shipText="Meetings module ships in Push 6 with Events."
      bodyHint="Logging past meetings + scheduling new ones from this surface land then."
      fields={
        <>
          <div className="grid grid-cols-2 gap-2">
            <DisabledField label="Date" placeholder="MM/DD/YYYY" />
            <DisabledField label="Time" placeholder="HH:MM" />
          </div>
          <DisabledField label="Duration" placeholder="e.g. 60 min" />
          <DisabledField label="Attendees" placeholder="Add contacts…" />
          <DisabledField label="Notes" placeholder="What was discussed?" area />
        </>
      }
    />
  )
}

export function LogSmsModal({
  open,
  onClose,
  contactId,
  contactLabel,
}: {
  open: boolean
  onClose: () => void
  contactId: string
  contactLabel: string
}) {
  return (
    <PlaceholderModal
      open={open}
      onClose={onClose}
      contactId={contactId}
      contactLabel={contactLabel}
      title="Log SMS"
      shipText="SMS module ships in Push 5+ once the provider integration lands."
      bodyHint="Logging past texts + sending new ones from this surface land then."
      fields={
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-muted-foreground)]">To</label>
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2">
              <ContactPill contactId={contactId} label={contactLabel} />
            </div>
          </div>
          <DisabledField label="Direction" placeholder="Inbound / Outbound" />
          <DisabledField label="Message" placeholder="Type the SMS body" area />
        </>
      }
    />
  )
}

export function UploadFileModal({
  open,
  onClose,
  contactId,
  contactLabel,
}: {
  open: boolean
  onClose: () => void
  contactId: string
  contactLabel: string
}) {
  return (
    <PlaceholderModal
      open={open}
      onClose={onClose}
      contactId={contactId}
      contactLabel={contactLabel}
      title="Upload file"
      shipText="Files attach to contact in Push 11 (Finance + Files surface)."
      bodyHint={
        "The blob upload pipeline already exists — once the file → contact join table ships, uploads land here and surface in the right-sidebar Files section."
      }
      fields={
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-xs text-[var(--color-muted-foreground)]">
          Drop files here or browse — Push 11.
        </div>
      }
      withFollowUp={false}
    />
  )
}
