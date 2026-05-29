"use client"

import { useState, type ReactNode } from "react"
import { Calendar, CheckSquare, Mail, MoreHorizontal, Phone, StickyNote } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Popover } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { AddNoteModal } from "./add-note-modal"
import { LogCallModal } from "./log-call-modal"

/**
 * Push 3 (C6c polish) — 6-button action icon row.
 *
 * Replaces the C6c text buttons (Add note / Log call) with HubSpot's
 * circular icon affordances. Six entries, in order:
 *   1. Note      → opens AddNoteModal
 *   2. Email     → mailto:${primaryEmail} (cheap real outbound)
 *   3. Call      → tel:${primaryPhone}
 *   4. Task      → disabled, tooltip "Tasks ship in Push 7"
 *   5. Meeting   → disabled, tooltip "Meetings ship in Push 6"
 *   6. More      → dropdown with "Log past Note", "Log past Call",
 *                  and placeholders for Email / Meeting / SMS
 *
 * Per memory #29 the design IS the long-term design — when later
 * modules ship (Push 6 Events, Push 7 Tasks, etc.) the disabled /
 * placeholder rows get un-wired without a visual rework.
 *
 * Note: tooltips use the native `title` attribute for V1 simplicity.
 * A styled tooltip primitive arrives in a later polish push.
 */
export function ActionIconRow({
  contactId,
  primaryEmail,
  primaryPhone,
}: {
  contactId: string
  primaryEmail: string | null
  primaryPhone: string | null
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [pastNoteOpen, setPastNoteOpen] = useState(false)
  const [pastCallOpen, setPastCallOpen] = useState(false)
  const [placeholderOpen, setPlaceholderOpen] = useState<null | {
    title: string
    text: string
  }>(null)

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

      {/* More dropdown */}
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
          <MoreItem
            label="Log past Note"
            onClick={() => {
              setPastNoteOpen(true)
            }}
          />
          <MoreItem
            label="Log past Call"
            onClick={() => {
              setPastCallOpen(true)
            }}
          />
          <MoreItem
            label="Log past Email"
            onClick={() => {
              setPlaceholderOpen({
                title: "Log past Email",
                text: "Logging past emails ships with the email module in Push 5+.",
              })
            }}
          />
          <MoreItem
            label="Log past Meeting"
            onClick={() => {
              setPlaceholderOpen({
                title: "Log past Meeting",
                text: "Logging past meetings ships with the Events module in Push 6.",
              })
            }}
          />
          <MoreItem
            label="Log past SMS"
            onClick={() => {
              setPlaceholderOpen({
                title: "Log past SMS",
                text: "Logging past SMS ships with the SMS provider integration in Push 5+.",
              })
            }}
          />
        </ul>
      </Popover>

      <AddNoteModal
        open={noteOpen || pastNoteOpen}
        onClose={() => {
          setNoteOpen(false)
          setPastNoteOpen(false)
        }}
        contactId={contactId}
      />
      <LogCallModal
        open={callOpen || pastCallOpen}
        onClose={() => {
          setCallOpen(false)
          setPastCallOpen(false)
        }}
        contactId={contactId}
      />

      {placeholderOpen && (
        <Modal
          open={true}
          onClose={() => {
            setPlaceholderOpen(null)
          }}
          title={placeholderOpen.title}
        >
          <p className="text-sm text-[var(--color-muted-foreground)]">{placeholderOpen.text}</p>
        </Modal>
      )}
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
