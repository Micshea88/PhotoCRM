"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import {
  ActivityModalChrome,
  AssociationsSection,
  ContactPill,
  FollowUpTaskAffordance,
  type AssociationOption,
  type AssociationsDraft,
} from "@/components/ui/activity-modal-chrome"
import { logCall } from "@/modules/calls/actions"
import type { CallDirection } from "@/modules/calls/types"

/**
 * Push 3 (C6c polish #4) — Log Call modal redesign (HubSpot pattern).
 *
 * Uses the shared ActivityModalChrome. Body sections:
 *   1. For: [Contact pill]
 *   2. Outcome dropdown (5 options per the locked spec)
 *   3. Direction (incoming / outgoing / missed)
 *   4. Duration (minutes, optional)
 *   5. Notes textarea ("What did you discuss?")
 *   6. AssociationsSection (read-only single-contact)
 *   7. FollowUpTaskAffordance (disabled stub)
 *   8. Create button
 *
 * The outcome is prepended to the notes field as "Outcome: X" since
 * call_log has no dedicated outcome column. Adding a real column is
 * a small follow-up once the format proves out at smoke.
 */
const OUTCOMES = ["Connected", "Voicemail", "No answer", "Busy", "Wrong number"] as const
type Outcome = (typeof OUTCOMES)[number]

const DIRECTIONS: { value: CallDirection; label: string }[] = [
  { value: "outgoing", label: "Outgoing" },
  { value: "incoming", label: "Incoming" },
  { value: "missed", label: "Missed" },
]

export function LogCallModal({
  open,
  onClose,
  contactId,
  contactLabel,
  contactOptions = [],
  companyOptions = [],
}: {
  open: boolean
  onClose: () => void
  contactId: string
  contactLabel?: string
  contactOptions?: AssociationOption[]
  companyOptions?: AssociationOption[]
}) {
  const router = useRouter()
  const [direction, setDirection] = useState<CallDirection | null>("outgoing")
  const [outcome, setOutcome] = useState<Outcome | null>("Connected")
  const [durationMin, setDurationMin] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [associations, setAssociations] = useState<AssociationsDraft>({
    contactIds: [contactId],
    companyIds: [],
    eventIds: [],
  })
  const [, startTransition] = useTransition()
  const label = contactLabel ?? "this contact"

  function reset() {
    setDirection("outgoing")
    setOutcome("Connected")
    setDurationMin("")
    setNotes("")
    setError(null)
  }

  function handleClose() {
    if (busy) return
    reset()
    onClose()
  }

  async function submit() {
    if (busy) return
    if (!direction) {
      setError("Pick a direction.")
      return
    }
    if (!outcome) {
      setError("Pick an outcome.")
      return
    }
    const parsedMin = parseInt(durationMin.trim() || "0", 10)
    const durationSeconds = Number.isFinite(parsedMin) ? parsedMin * 60 : 0
    if (durationSeconds < 0 || durationSeconds > 86_400) {
      setError("Duration must be between 0 and 1440 minutes.")
      return
    }
    const combinedNotes = notes.trim()
      ? `Outcome: ${outcome}\n${notes.trim()}`
      : `Outcome: ${outcome}`
    setBusy(true)
    setError(null)
    const result = await logCall({
      contactId,
      startedAt: new Date().toISOString(),
      direction,
      durationSeconds: durationSeconds > 0 ? durationSeconds : null,
      notes: combinedNotes,
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

  function hasUnsavedChanges(): boolean {
    return notes.trim().length > 0 || durationMin.trim().length > 0
  }

  return (
    <ActivityModalChrome
      open={open}
      onClose={handleClose}
      title="Log call"
      onBeforeClose={() => {
        if (!hasUnsavedChanges()) return true
        return window.confirm("Discard this call log?")
      }}
      footer={
        <div className="flex items-center justify-between gap-2 text-[11px]">
          {error ? (
            <span className="text-red-600">{error}</span>
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
            data-testid="log-call-submit"
          >
            {busy ? "Saving…" : "Create"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          For: <ContactPill contactId={contactId} label={label} />
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-muted-foreground)]">
            Outcome
          </label>
          <SearchableSelect
            items={OUTCOMES.map((o) => ({ value: o, label: o }))}
            value={outcome}
            onChange={(v) => {
              setOutcome(v as Outcome | null)
            }}
            placeholder="Pick outcome"
            aria-label="Outcome"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-muted-foreground)]">
            Direction
          </label>
          <SearchableSelect
            items={DIRECTIONS}
            value={direction}
            onChange={(v) => {
              setDirection(v as CallDirection | null)
            }}
            placeholder="Pick direction"
            aria-label="Direction"
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-[var(--color-muted-foreground)]"
            htmlFor="log-call-duration"
          >
            Duration (minutes, optional)
          </label>
          <Input
            id="log-call-duration"
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            value={durationMin}
            onChange={(e) => {
              setDurationMin(e.target.value)
            }}
            disabled={busy}
            placeholder="e.g. 5"
            className="h-8"
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-[var(--color-muted-foreground)]"
            htmlFor="log-call-notes"
          >
            What did you discuss?
          </label>
          <textarea
            id="log-call-notes"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
            }}
            rows={4}
            maxLength={10_000}
            disabled={busy}
            placeholder="Notes about the call"
            data-testid="log-call-notes"
            className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none disabled:opacity-50"
          />
        </div>

        <AssociationsSection
          contactId={contactId}
          contactLabel={label}
          draft={associations}
          onChange={setAssociations}
          contactOptions={contactOptions}
          companyOptions={companyOptions}
        />
        <FollowUpTaskAffordance />
      </div>
    </ActivityModalChrome>
  )
}
