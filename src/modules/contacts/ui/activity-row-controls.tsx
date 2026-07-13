"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { SingleSelectMenu, type SingleSelectOption } from "@/components/ui/single-select-menu"
import { cn } from "@/lib/utils"
import { updateContactNote } from "@/modules/contacts/actions"
import { updateCall } from "@/modules/calls/actions"
import { updateMeeting } from "@/modules/meetings/actions"
import { updateEmail } from "@/modules/email-log/actions"
import { RECORDED_CALL_DISPOSITIONS, dispositionDisplayLabel } from "@/modules/calls/types"
import { MEETING_OUTCOMES } from "@/modules/meetings/types"

/**
 * Per-row event + outcome quick-edit controls for an activity card (Phase D2).
 * Reuses SingleSelectMenu; dispatches the right update action by kind. Event
 * picker shows on note/call/email/meeting rows (SMS deferred to Commit 4);
 * outcome quick-set shows on call rows (disposition) + meeting rows (outcome).
 *
 * Plain-English chips (rule #11): "No event" when unset, the disposition/
 * outcome label or "Set outcome" when unset.
 */
export interface ActivityEventOption {
  id: string
  name: string
}

interface RowEntry {
  kind: string
  rawId?: string
  projectId?: string | null
  outcome?: string | null
  callDisposition?: string | null
}

const EVENT_NONE = "none"
const OUTCOME_NONE = "none"

const EVENT_KINDS = new Set(["note", "call", "email", "meeting"])

async function setEvent(entry: RowEntry, projectId: string | null): Promise<string | undefined> {
  const id = entry.rawId
  if (!id) return undefined
  switch (entry.kind) {
    case "note":
      return (await updateContactNote({ id, projectId })).serverError
    case "call":
      return (await updateCall({ id, projectId })).serverError
    case "meeting":
      return (await updateMeeting({ id, projectId })).serverError
    case "email":
      return (await updateEmail({ id, projectId })).serverError
    default:
      return undefined
  }
}

function ChipTrigger({
  label,
  active,
  toggle,
  testId,
}: {
  label: string
  active: boolean
  toggle: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={toggle}
      data-testid={testId}
      className={cn(
        "text-2xs inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors",
        active
          ? "border-[var(--color-primary)] text-[var(--color-primary)]"
          : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--state-hover)]",
      )}
    >
      <span>{label}</span>
      <ChevronDown className="size-3" aria-hidden="true" />
    </button>
  )
}

export function ActivityRowControls({
  entry,
  eventOptions,
}: {
  entry: RowEntry
  eventOptions: ActivityEventOption[]
}) {
  const router = useRouter()
  const [, transition] = useTransition()
  const [busy, setBusy] = useState(false)

  if (!entry.rawId) return null
  const showEvent = EVENT_KINDS.has(entry.kind)
  const showOutcome = entry.kind === "call" || entry.kind === "meeting"
  if (!showEvent && !showOutcome) return null

  async function run(work: Promise<string | undefined>) {
    setBusy(true)
    const serverError = await work
    setBusy(false)
    if (!serverError) {
      transition(() => {
        router.refresh()
      })
    }
  }

  // Event chip
  const eventValue = entry.projectId ?? EVENT_NONE
  const eventLabel =
    entry.projectId != null
      ? (eventOptions.find((e) => e.id === entry.projectId)?.name ?? "Event")
      : "No event"
  const eventMenuOptions: SingleSelectOption[] = [
    ...eventOptions.map((e) => ({ value: e.id, label: e.name })),
    { value: EVENT_NONE, label: "No event", dividerBefore: eventOptions.length > 0 },
  ]

  // Outcome chip (call disposition / meeting outcome)
  const isCall = entry.kind === "call"
  const outcomeValue = (isCall ? entry.callDisposition : entry.outcome) ?? OUTCOME_NONE
  const outcomeMenuOptions: SingleSelectOption[] = isCall
    ? RECORDED_CALL_DISPOSITIONS.map((d) => ({ value: d, label: dispositionDisplayLabel(d) }))
    : MEETING_OUTCOMES.map((o) => ({ value: o, label: o }))
  const outcomeLabel =
    outcomeValue === OUTCOME_NONE
      ? "Set outcome"
      : isCall
        ? dispositionDisplayLabel(outcomeValue as (typeof RECORDED_CALL_DISPOSITIONS)[number])
        : outcomeValue

  async function applyOutcome(value: string) {
    if (!entry.rawId) return
    if (isCall) {
      await run(
        updateCall({
          id: entry.rawId,
          disposition: value as (typeof RECORDED_CALL_DISPOSITIONS)[number],
        }).then((r) => r.serverError),
      )
    } else {
      await run(
        updateMeeting({
          id: entry.rawId,
          outcome: value as (typeof MEETING_OUTCOMES)[number],
        }).then((r) => r.serverError),
      )
    }
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 pl-7", busy && "opacity-50")}
      data-testid={`activity-row-controls-${entry.kind}`}
    >
      {showEvent && (
        <SingleSelectMenu
          options={eventMenuOptions}
          value={eventValue}
          onChange={(v) => {
            void run(setEvent(entry, v === EVENT_NONE ? null : v))
          }}
          align="start"
          ariaLabel="Set event"
          trigger={({ open, toggle }) => (
            <ChipTrigger
              label={eventLabel}
              active={entry.projectId != null || open}
              toggle={toggle}
              testId={`activity-event-${entry.kind}`}
            />
          )}
        />
      )}
      {showOutcome && (
        <SingleSelectMenu
          options={outcomeMenuOptions}
          value={outcomeValue}
          onChange={(v) => {
            void applyOutcome(v)
          }}
          align="start"
          ariaLabel="Set outcome"
          trigger={({ open, toggle }) => (
            <ChipTrigger
              label={outcomeLabel}
              active={outcomeValue !== OUTCOME_NONE || open}
              toggle={toggle}
              testId={`activity-outcome-${entry.kind}`}
            />
          )}
        />
      )}
    </div>
  )
}
