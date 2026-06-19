"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/components/ui/modal"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { createProject } from "../actions"

export interface EventOption {
  id: string
  name: string
}

/**
 * Single-select Event picker with an inline "Add event" affordance.
 *
 * Mirrors CompanyPicker (companies/ui/company-picker.tsx): a native <select>
 * for the existing events (browser-native typeahead is enough at single-studio
 * scale) plus a "+ New event" button that opens a small modal capturing the
 * event name (and optional date) and calling `createProject`. On success it
 * selects the new event via `onChange` so the caller picks it up.
 *
 * "Event" is the photographer-facing label for a project (terminology_map);
 * this component speaks Events, the action writes projects.
 */
export function EventPicker({
  id,
  options,
  value,
  onChange,
  onEventCreated,
  allowEmpty = true,
  emptyLabel = "— No event —",
  placeholder = "Select an event",
}: {
  id?: string
  options: EventOption[]
  value: string | null
  onChange: (id: string | null) => void
  onEventCreated?: (event: EventOption) => void
  allowEmpty?: boolean
  emptyLabel?: string
  placeholder?: string
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState("")
  const [eventDate, setEventDate] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sorted = useMemo(() => {
    return [...options].sort((a, b) => a.name.localeCompare(b.name))
  }, [options])

  async function onCreate() {
    if (!name.trim()) {
      setError("Event name is required.")
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await createProject({
      name: name.trim(),
      ...(eventDate ? { primaryDate: eventDate } : {}),
    })
    setSubmitting(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    if (result.validationErrors) {
      setError("Please fix the form errors above.")
      return
    }
    if (result.data?.id) {
      const newEvent: EventOption = { id: result.data.id, name: name.trim() }
      onEventCreated?.(newEvent)
      onChange(newEvent.id)
      setName("")
      setEventDate("")
      setModalOpen(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        id={id}
        className="h-9 flex-1 rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
        value={value ?? ""}
        onChange={(e) => {
          onChange(e.target.value === "" ? null : e.target.value)
        }}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {!value && !allowEmpty && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {sorted.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null)
          setModalOpen(true)
        }}
      >
        + New event
      </Button>

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!submitting) setModalOpen(false)
        }}
        title="Add event"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-event-name">Event name</Label>
            <Input
              id="new-event-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
              }}
              placeholder="Smith Wedding"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-event-date">Event date (optional)</Label>
            <Input
              id="new-event-date"
              type="date"
              value={eventDate}
              onChange={(e) => {
                setEventDate(e.target.value)
              }}
            />
            <p className="text-xs text-[var(--color-muted-foreground)]">
              You can fill in the rest of the event details later.
            </p>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setModalOpen(false)
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void onCreate()
              }}
              disabled={submitting}
            >
              {submitting ? "Creating…" : "Create event"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
