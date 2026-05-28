"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { logCall } from "@/modules/calls/actions"
import type { CallDirection } from "@/modules/calls/types"

/**
 * Push 3 (C6c) — Log Call modal.
 *
 * Wires to the existing `logCall` orgAction. The schema (callLog
 * table) has direction + notes + duration but NO dedicated outcome
 * column. Per autonomous default C the modal exposes 4 outcome
 * options ("No answer" / "Voicemail" / "Connected" / "Wrong
 * number") — we prepend the chosen outcome to the notes field as
 * "Outcome: X\n[free-form notes]" so the activity feed renders it.
 * Adding a real outcome column is a small follow-up if the format
 * proves too fragile in practice.
 *
 * Required fields: direction (incoming/outgoing/missed) + outcome.
 * Optional: duration in minutes + free-form notes.
 */
const DIRECTIONS: { value: CallDirection; label: string }[] = [
  { value: "outgoing", label: "Outgoing" },
  { value: "incoming", label: "Incoming" },
  { value: "missed", label: "Missed" },
]

const OUTCOMES = ["Connected", "No answer", "Voicemail", "Wrong number"] as const
type Outcome = (typeof OUTCOMES)[number]

export function LogCallModal({
  open,
  onClose,
  contactId,
}: {
  open: boolean
  onClose: () => void
  contactId: string
}) {
  const router = useRouter()
  const [direction, setDirection] = useState<CallDirection | null>("outgoing")
  const [outcome, setOutcome] = useState<Outcome | null>("Connected")
  const [durationMin, setDurationMin] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleClose() {
    if (busy) return
    setDirection("outgoing")
    setOutcome("Connected")
    setDurationMin("")
    setNotes("")
    setError(null)
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

  return (
    <Modal open={open} onClose={handleClose} title="Log call">
      <div className="space-y-3">
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
          />
        </div>
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-[var(--color-muted-foreground)]"
            htmlFor="log-call-notes"
          >
            Notes (optional)
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
            placeholder="What did you talk about?"
            data-testid="log-call-notes"
            className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none disabled:opacity-50"
          />
        </div>
        {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-row-reverse gap-2">
          <Button
            type="button"
            onClick={() => {
              void submit()
            }}
            disabled={busy}
            data-testid="log-call-submit"
          >
            {busy ? "Saving…" : "Log call"}
          </Button>
          <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
