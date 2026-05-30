"use client"

import { useState, type ReactNode } from "react"
import { Calendar, CheckSquare, Mail, MoreHorizontal, Phone, StickyNote } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { AssociationOption } from "@/components/ui/activity-modal-chrome"
import { AddNoteModal } from "./add-note-modal"
import { LogCallModal } from "./log-call-modal"
import {
  LogEmailModal,
  LogMeetingModal,
  LogSmsModal,
  UploadFileModal,
} from "./log-placeholder-modals"

/**
 * Push 3 (C6c polish #4) — action icon row with the new More dropdown.
 *
 * Six circular icon buttons, in this order:
 *   1. Note      → opens AddNoteModal (HubSpot-style redesign)
 *   2. Email     → mailto:${primaryEmail} (real outbound)
 *   3. Call      → tel:${primaryPhone}
 *   4. Task      → disabled, tooltip "Tasks ship in Push 7"
 *   5. Meeting   → disabled, tooltip "Meetings ship in Push 6"
 *   6. More      → dropdown
 *
 * More dropdown (polish #4 — "Log note" removed; redundant with the
 * Note icon. Upload file added at the bottom.):
 *   - Log call → opens LogCallModal
 *   - Log email → placeholder LogEmailModal
 *   - Log meeting → placeholder LogMeetingModal
 *   - Log SMS → placeholder LogSmsModal
 *   - --- divider ---
 *   - Upload file → placeholder UploadFileModal
 */
export function ActionIconRow({
  contactId,
  contactLabel,
  primaryEmail,
  primaryPhone,
  contactOptions = [],
  companyOptions = [],
}: {
  contactId: string
  /** Display name surfaced as the "For" pill across every activity modal. */
  contactLabel: string
  primaryEmail: string | null
  primaryPhone: string | null
  /** Forwarded to AssociationsPicker in every modal that supports it. */
  contactOptions?: AssociationOption[]
  companyOptions?: AssociationOption[]
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [smsOpen, setSmsOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  const canEmail = !!primaryEmail && primaryEmail.length > 0
  const canCall = !!primaryPhone && primaryPhone.length > 0

  return (
    <div className="flex items-start justify-around gap-1" data-testid="contact-detail-action-row">
      <IconButton
        icon={<StickyNote className="size-4" aria-hidden="true" />}
        label="Note"
        onClick={() => {
          setNoteOpen(true)
        }}
      />
      <IconButton
        icon={<Mail className="size-4" aria-hidden="true" />}
        label="Email"
        href={canEmail ? `mailto:${primaryEmail}` : undefined}
        disabled={!canEmail}
        disabledTitle={canEmail ? undefined : "No email on file"}
      />
      <IconButton
        icon={<Phone className="size-4" aria-hidden="true" />}
        label="Call"
        href={canCall ? `tel:${primaryPhone}` : undefined}
        disabled={!canCall}
        disabledTitle={canCall ? undefined : "No phone on file"}
      />
      <IconButton
        icon={<CheckSquare className="size-4" aria-hidden="true" />}
        label="Task"
        disabled
        disabledTitle="Tasks ship in Push 7"
      />
      <IconButton
        icon={<Calendar className="size-4" aria-hidden="true" />}
        label="Meeting"
        disabledTitle="Meetings ship in Push 6"
        disabled
      />

      <Popover
        align="end"
        trigger={({ toggle }) => (
          <IconButton
            icon={<MoreHorizontal className="size-4" aria-hidden="true" />}
            label="More"
            onClick={toggle}
            data-testid="action-row-more"
          />
        )}
      >
        <ul className="min-w-[200px] space-y-0.5 text-sm" role="menu">
          {/* P3 (C6c polish #4) — "Log note" removed (redundant with
              the Note icon above). Items grouped as: Log X stack /
              divider / Upload file. */}
          <MoreItem
            label="Log call"
            onClick={() => {
              setCallOpen(true)
            }}
          />
          <MoreItem
            label="Log email"
            onClick={() => {
              setEmailOpen(true)
            }}
          />
          <MoreItem
            label="Log meeting"
            onClick={() => {
              setMeetingOpen(true)
            }}
          />
          <MoreItem
            label="Log SMS"
            onClick={() => {
              setSmsOpen(true)
            }}
          />
          <li className="my-1 border-t border-[var(--color-border)]" aria-hidden="true" />
          <MoreItem
            label="Upload file"
            onClick={() => {
              setUploadOpen(true)
            }}
          />
        </ul>
      </Popover>

      <AddNoteModal
        open={noteOpen}
        onClose={() => {
          setNoteOpen(false)
        }}
        contactId={contactId}
        contactLabel={contactLabel}
        contactOptions={contactOptions}
        companyOptions={companyOptions}
      />
      <LogCallModal
        open={callOpen}
        onClose={() => {
          setCallOpen(false)
        }}
        contactId={contactId}
        contactLabel={contactLabel}
        contactOptions={contactOptions}
        companyOptions={companyOptions}
      />
      <LogEmailModal
        open={emailOpen}
        onClose={() => {
          setEmailOpen(false)
        }}
        contactId={contactId}
        contactLabel={contactLabel}
        fromLabel="(current user)"
      />
      <LogMeetingModal
        open={meetingOpen}
        onClose={() => {
          setMeetingOpen(false)
        }}
        contactId={contactId}
        contactLabel={contactLabel}
      />
      <LogSmsModal
        open={smsOpen}
        onClose={() => {
          setSmsOpen(false)
        }}
        contactId={contactId}
        contactLabel={contactLabel}
      />
      <UploadFileModal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false)
        }}
        contactId={contactId}
        contactLabel={contactLabel}
      />
    </div>
  )
}

function IconButton({
  icon,
  label,
  onClick,
  href,
  disabled,
  disabledTitle,
  "data-testid": testId,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  href?: string
  disabled?: boolean
  disabledTitle?: string
  "data-testid"?: string
}) {
  const circleClass = cn(
    "flex size-9 items-center justify-center rounded-full",
    disabled
      ? "cursor-not-allowed bg-[var(--color-muted)] text-[var(--color-muted-foreground)] opacity-60"
      : "bg-[var(--color-muted)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]",
  )
  const inner = (
    <>
      <span className={circleClass}>{icon}</span>
      <span className="text-[11px] text-[var(--color-muted-foreground)]">{label}</span>
    </>
  )
  if (href && !disabled) {
    return (
      <a
        href={href}
        title={label}
        data-testid={testId}
        className="flex flex-col items-center gap-1 px-1"
      >
        {inner}
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabledTitle ?? label}
      data-testid={testId}
      className="flex flex-col items-center gap-1 px-1"
    >
      {inner}
    </button>
  )
}

function MoreItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--color-accent)]/40"
      >
        {label}
      </button>
    </li>
  )
}
