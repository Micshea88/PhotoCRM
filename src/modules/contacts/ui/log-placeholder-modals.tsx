"use client"

import { type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  ActivityModalChrome,
  AssociationsSection,
  ContactPill,
  FollowUpTaskAffordance,
} from "@/components/ui/activity-modal-chrome"

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
        <div className="flex items-center justify-between gap-2 text-[11px]">
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
  return (
    <PlaceholderModal
      open={open}
      onClose={onClose}
      contactId={contactId}
      contactLabel={contactLabel}
      title="Log email"
      shipText="Email module ships in Push 5+."
      bodyHint="Logging an existing email + composing new ones from this surface land then."
      fields={
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-muted-foreground)]">From</label>
            <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
              {fromLabel}
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-muted-foreground)]">To</label>
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2">
              <ContactPill contactId={contactId} label={contactLabel} />
            </div>
          </div>
          <DisabledField label="Subject" placeholder="Subject line" />
          <DisabledField label="Body" placeholder="Type the email body" area />
        </>
      }
    />
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
