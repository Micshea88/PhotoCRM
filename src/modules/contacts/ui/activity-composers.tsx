"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Calendar, Mail, Paperclip, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { createContactNote } from "@/modules/contacts/actions"
import { logCall } from "@/modules/calls/actions"
import { logEmail } from "@/modules/email-log/actions"
import { logMeeting } from "@/modules/meetings/actions"
import { logSms } from "@/modules/sms-messages/actions"
import type { CallDirection } from "@/modules/calls/types"

/**
 * P-activities — inline composers that ship in the new Activities
 * tab. Replaces the modal-only logging from §9 of the design system
 * — per Mike's update, V1 composers live INLINE above the feed.
 *
 * Surfaces:
 *   - NoteComposer       inline rich-text body
 *   - CallLogComposer    date/time, outcome, direction, duration,
 *                        notes + (Push-7-gated) follow-up task toggle
 *   - EmailLogComposer   date/time, subject, body
 *   - MeetingLogComposer date/time, attendees, notes
 *   - SmsLogComposer     body
 *
 * Connect-gate pop-outs (V1.5 integrations stubbed):
 *   - CreateEmailPopout
 *   - ScheduleMeetingPopout
 * Each shows a "Connect a <provider>" empty state; the action
 * button is disabled with a ship-target tooltip until the
 * integration lands.
 *
 * All composers auto-associate to the current contact (V1 single-
 * contact persistence; multi-record associations land in Push 3.5+
 * per §9). Every save calls the action which busts the AI cache via
 * `invalidateContactAiCache` so the next render auto-regens.
 */

interface ComposerBaseProps {
  contactId: string
  onSaved: () => void
  onCancel: () => void
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 16)
}

function ComposerShell({
  title,
  children,
  saveLabel,
  saving,
  error,
  canSave,
  onSave,
  onCancel,
}: {
  title: string
  children: React.ReactNode
  saveLabel: string
  saving: boolean
  error: string | null
  canSave: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
      data-testid="activity-composer"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/40"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {children}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400" data-testid="composer-error">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={saving || !canSave}
          data-testid="composer-save"
        >
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  )
}

function refresh(router: ReturnType<typeof useRouter>, transition: (cb: () => void) => void) {
  transition(() => {
    router.refresh()
  })
}

// ─── Note composer ────────────────────────────────────────────────────

export function NoteComposer({ contactId, onSaved, onCancel }: ComposerBaseProps) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, transition] = useTransition()
  return (
    <ComposerShell
      title="Create a note"
      saveLabel="Save note"
      saving={saving}
      error={error}
      canSave={body.trim().length > 0}
      onCancel={onCancel}
      onSave={async () => {
        setSaving(true)
        setError(null)
        const result = await createContactNote({ contactId, body: body.trim() })
        setSaving(false)
        if (result.serverError) {
          setError(result.serverError)
          return
        }
        setBody("")
        onSaved()
        refresh(router, transition)
      }}
    >
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
        }}
        placeholder="What's the note?"
        rows={4}
        maxLength={10_000}
        disabled={saving}
        aria-label="Note body"
        data-testid="note-composer-body"
        className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none disabled:opacity-50"
      />
      <div
        className="flex items-center gap-1 text-[var(--color-muted-foreground)]"
        aria-label="Formatting toolbar"
      >
        <ToolbarStub icon={<Paperclip className="size-3.5" aria-hidden="true" />} label="Attach" />
      </div>
    </ComposerShell>
  )
}

function ToolbarStub({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      title={`${label} ships in V1.5 polish.`}
      disabled
      aria-label={label}
      className="inline-flex size-7 cursor-not-allowed items-center justify-center rounded opacity-60"
    >
      {icon}
    </button>
  )
}

// ─── Call log composer ────────────────────────────────────────────────

const CALL_OUTCOMES = ["Connected", "Left voicemail", "No answer", "Busy", "Wrong number"] as const

// Backlog Item 1e — Mike's approved spec: direction = Outbound /
// Inbound only. "Missed" was extra; dropped. A call you didn't pick
// up gets logged as Inbound with outcome "No answer" instead.
const CALL_DIRECTIONS: { value: CallDirection; label: string }[] = [
  { value: "outgoing", label: "Outbound" },
  { value: "incoming", label: "Inbound" },
]

export function CallLogComposer({ contactId, onSaved, onCancel }: ComposerBaseProps) {
  const router = useRouter()
  const [startedAt, setStartedAt] = useState(nowIso())
  const [outcome, setOutcome] = useState<string | null>("Connected")
  const [direction, setDirection] = useState<CallDirection | null>("outgoing")
  const [durationMin, setDurationMin] = useState("")
  const [notes, setNotes] = useState("")
  const [createFollowUp, setCreateFollowUp] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, transition] = useTransition()
  return (
    <ComposerShell
      title="Log a call"
      saveLabel="Save call"
      saving={saving}
      error={error}
      canSave={!!outcome && !!direction}
      onCancel={onCancel}
      onSave={async () => {
        if (!outcome || !direction) {
          setError("Pick an outcome and direction.")
          return
        }
        setSaving(true)
        setError(null)
        const parsedMin = parseInt(durationMin.trim() || "0", 10)
        const durationSeconds = Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin * 60 : null
        const combinedNotes = notes.trim()
          ? `Outcome: ${outcome}\n${notes.trim()}`
          : `Outcome: ${outcome}`
        const result = await logCall({
          contactId,
          startedAt: new Date(startedAt).toISOString(),
          direction,
          durationSeconds,
          notes: combinedNotes,
        })
        setSaving(false)
        if (result.serverError) {
          setError(result.serverError)
          return
        }
        onSaved()
        refresh(router, transition)
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="When">
          <Input
            type="datetime-local"
            value={startedAt}
            onChange={(e) => {
              setStartedAt(e.target.value)
            }}
            disabled={saving}
            className="h-8"
            data-testid="call-composer-when"
          />
        </Field>
        <Field label="Duration (min)">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            value={durationMin}
            onChange={(e) => {
              setDurationMin(e.target.value)
            }}
            placeholder="e.g. 5"
            disabled={saving}
            className="h-8"
          />
        </Field>
        <Field label="Outcome">
          <SearchableSelect
            items={CALL_OUTCOMES.map((o) => ({ value: o, label: o }))}
            value={outcome}
            onChange={(v) => {
              setOutcome(v)
            }}
            aria-label="Outcome"
            placeholder="Pick outcome"
          />
        </Field>
        <Field label="Direction">
          <SearchableSelect
            items={CALL_DIRECTIONS}
            value={direction}
            onChange={(v) => {
              setDirection(v as CallDirection | null)
            }}
            aria-label="Direction"
            placeholder="Pick direction"
          />
        </Field>
      </div>
      <Field label="What happened?">
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
          }}
          rows={3}
          maxLength={10_000}
          disabled={saving}
          placeholder="Notes about the call"
          data-testid="call-composer-notes"
          className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none disabled:opacity-50"
        />
      </Field>
      {/* Tasks are project-scoped today (NOT NULL projectId);
          contact-scoped follow-up tasks ship with Push 7. Toggle
          renders disabled with the ship-target tooltip — the design
          surface is intact so wiring is one-line when P7 lands. */}
      <label
        className="flex cursor-not-allowed items-center gap-2 text-xs opacity-60"
        title="Contact-scoped follow-up tasks ship in Push 7."
      >
        <input
          type="checkbox"
          checked={createFollowUp}
          onChange={(e) => {
            setCreateFollowUp(e.target.checked)
          }}
          disabled
        />
        <span>Create a follow-up task (ships in Push 7)</span>
      </label>
    </ComposerShell>
  )
}

// ─── Email log composer ──────────────────────────────────────────────

export function EmailLogComposer({ contactId, onSaved, onCancel }: ComposerBaseProps) {
  // P-email-log — the manual Log-an-email path. Writes directly to the
  // first-class email_log table via logEmail. Source is "manual";
  // direction defaults to "outbound" (the V1 surface only logs sent
  // mail; inbound arrives via future provider ingest). The action
  // already busts the contact's AI cache atomically + audit() +
  // revalidatePath — composer just calls it.
  const router = useRouter()
  const [when, setWhen] = useState(nowIso())
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, transition] = useTransition()
  return (
    <ComposerShell
      title="Log an email"
      saveLabel="Save email"
      saving={saving}
      error={error}
      canSave={body.trim().length > 0 || subject.trim().length > 0}
      onCancel={onCancel}
      onSave={async () => {
        setSaving(true)
        setError(null)
        const trimmedSubject = subject.trim()
        const trimmedBody = body.trim()
        const result = await logEmail({
          contactId,
          sentAt: new Date(when).toISOString(),
          direction: "outbound",
          subject: trimmedSubject.length > 0 ? trimmedSubject : null,
          body: trimmedBody.length > 0 ? trimmedBody : null,
        })
        setSaving(false)
        if (result.serverError) {
          setError(result.serverError)
          return
        }
        onSaved()
        refresh(router, transition)
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="When">
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => {
              setWhen(e.target.value)
            }}
            disabled={saving}
            className="h-8"
          />
        </Field>
        <Field label="Subject">
          <Input
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value)
            }}
            placeholder="Email subject"
            disabled={saving}
            className="h-8"
          />
        </Field>
      </div>
      {/* Item 1e — approved spec is date/time + subject + notes. */}
      <Field label="Notes">
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
          }}
          rows={4}
          maxLength={10_000}
          disabled={saving}
          placeholder="What did the email say?"
          className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none disabled:opacity-50"
        />
      </Field>
    </ComposerShell>
  )
}

// ─── Meeting log composer ────────────────────────────────────────────

export function MeetingLogComposer({ contactId, onSaved, onCancel }: ComposerBaseProps) {
  const router = useRouter()
  const [startsAt, setStartsAt] = useState(nowIso())
  const [attendees, setAttendees] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, transition] = useTransition()
  return (
    <ComposerShell
      title="Log a meeting"
      saveLabel="Save meeting"
      saving={saving}
      error={error}
      canSave={!!startsAt}
      onCancel={onCancel}
      onSave={async () => {
        setSaving(true)
        setError(null)
        // Item 1e — approved spec is date/time + attendees + notes.
        // No 'subject' field in V1. The attendees string is folded
        // into the notes body so the backing meetings table still
        // captures who was there.
        const combinedNotes = attendees.trim()
          ? `Attendees: ${attendees.trim()}\n${notes.trim()}`
          : notes.trim()
        const result = await logMeeting({
          contactId,
          startsAt: new Date(startsAt).toISOString(),
          subject: null,
          notes: combinedNotes || null,
        })
        setSaving(false)
        if (result.serverError) {
          setError(result.serverError)
          return
        }
        onSaved()
        refresh(router, transition)
      }}
    >
      <Field label="When">
        <Input
          type="datetime-local"
          value={startsAt}
          onChange={(e) => {
            setStartsAt(e.target.value)
          }}
          disabled={saving}
          className="h-8"
          data-testid="meeting-composer-when"
        />
      </Field>
      <Field label="Attendees">
        <Input
          type="text"
          value={attendees}
          onChange={(e) => {
            setAttendees(e.target.value)
          }}
          placeholder="Who attended"
          disabled={saving}
          className="h-8"
        />
      </Field>
      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
          }}
          rows={3}
          maxLength={10_000}
          disabled={saving}
          placeholder="What did you discuss?"
          className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none disabled:opacity-50"
        />
      </Field>
    </ComposerShell>
  )
}

// ─── SMS log composer ────────────────────────────────────────────────

export function SmsLogComposer({ contactId, onSaved, onCancel }: ComposerBaseProps) {
  const router = useRouter()
  // Item 1e — approved spec is body-only. Direction defaults to
  // outbound silently so the backing sms_messages row still has the
  // NOT NULL column populated; the user doesn't get a picker for it.
  // Inbound SMS arrive via the (future P5+) provider webhook.
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, transition] = useTransition()
  return (
    <ComposerShell
      title="Log an SMS"
      saveLabel="Save SMS"
      saving={saving}
      error={error}
      canSave={body.trim().length > 0}
      onCancel={onCancel}
      onSave={async () => {
        setSaving(true)
        setError(null)
        const result = await logSms({
          contactId,
          body: body.trim(),
          direction: "outbound",
        })
        setSaving(false)
        if (result.serverError) {
          setError(result.serverError)
          return
        }
        onSaved()
        refresh(router, transition)
      }}
    >
      <Field label="Message">
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
          }}
          rows={3}
          maxLength={10_000}
          disabled={saving}
          placeholder="Type the SMS body"
          className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none disabled:opacity-50"
        />
      </Field>
    </ComposerShell>
  )
}

// ─── Connect-gate pop-outs (V1.5 integrations stubbed) ──────────────

interface ConnectGateModalProps {
  open: boolean
  onClose: () => void
}

export function CreateEmailPopout({ open, onClose }: ConnectGateModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Compose email">
      <ConnectGate
        icon={<Mail className="size-5" aria-hidden="true" />}
        title="Connect an email account"
        body="Connect Gmail or Outlook to compose and send real emails from here. Inbound messages also auto-log."
        shipTarget="Email integration ships in Push 5+."
      />
    </Modal>
  )
}

export function ScheduleMeetingPopout({ open, onClose }: ConnectGateModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Schedule meeting">
      <ConnectGate
        icon={<Calendar className="size-5" aria-hidden="true" />}
        title="Connect a calendar"
        body="Connect Google Calendar or Outlook to send invites and auto-log meetings."
        shipTarget="Calendar integration ships in Push 8."
      />
    </Modal>
  )
}

function ConnectGate({
  icon,
  title,
  body,
  shipTarget,
}: {
  icon: React.ReactNode
  title: string
  body: string
  shipTarget: string
}) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
          {icon}
        </span>
        <p className="font-medium">{title}</p>
      </div>
      <p className="text-[var(--color-muted-foreground)]">{body}</p>
      <Button
        type="button"
        disabled
        title={shipTarget}
        className="cursor-not-allowed opacity-60"
        data-testid="connect-gate-button"
      >
        Connect
      </Button>
      <p className="text-[11px] text-[var(--color-muted-foreground)]">{shipTarget}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</label>
      {children}
    </div>
  )
}
