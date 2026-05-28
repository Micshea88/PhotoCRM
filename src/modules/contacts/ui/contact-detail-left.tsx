"use client"

import { useState } from "react"
import { Mail, Phone, Plus, User as UserIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineEditField } from "@/components/ui/inline-edit-field"
import { cn } from "@/lib/utils"
import { updateContact } from "@/modules/contacts/actions"
import { AddNoteModal } from "./add-note-modal"
import { LogCallModal } from "./log-call-modal"

/**
 * Push 3 (C6c) — left column on the desktop contact detail page.
 *
 * Identity card (name + email + phone, inline-editable per field) +
 * action button row (Add note / Log call / More) + a compact "About"
 * panel with the read-only secondary fields.
 *
 * Inline editing is wired to the existing updateContact action. Per
 * the testing-mode discipline, the primitive is intentionally
 * conservative — wired here for the four most-edited fields. Wider
 * field coverage can land in a follow-up once the pattern feels
 * right after smoke testing.
 */
export interface ContactDetailLeftProps {
  contact: {
    id: string
    firstName: string
    lastName: string
    primaryEmail: string | null
    primaryPhone: string | null
    contactType: string | null
    lifecycleStatus: string | null
    leadSource: string | null
  }
  owner: { name: string | null; email: string } | null
  companyName: string | null
}

export function ContactDetailLeft({ contact, owner, companyName }: ContactDetailLeftProps) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)

  // Factory — returns the InlineEditField onSave handler for one
  // contact field. Wraps updateContact + maps the dedup-conflict
  // result back into an inline error string.
  function saveField(field: "firstName" | "lastName" | "primaryEmail" | "primaryPhone") {
    return async (next: string): Promise<{ error?: string } | undefined> => {
      const value = next.trim() === "" ? null : next.trim()
      if ((field === "firstName" || field === "lastName") && !value) {
        return { error: `${field === "firstName" ? "First" : "Last"} name can't be empty.` }
      }
      const payload =
        field === "firstName"
          ? { id: contact.id, firstName: value ?? "" }
          : field === "lastName"
            ? { id: contact.id, lastName: value ?? "" }
            : field === "primaryEmail"
              ? { id: contact.id, primaryEmail: value ?? undefined }
              : { id: contact.id, primaryPhone: value ?? undefined }
      const result = await updateContact(payload)
      if (result.serverError) return { error: result.serverError }
      const data = result.data
      if (data && "dedupConflict" in data) {
        return {
          error: "Duplicate of an existing contact — change the value or open the matched contact.",
        }
      }
      return undefined
    }
  }

  return (
    <aside className="space-y-4">
      {/* Identity card */}
      <section
        className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
        data-testid="contact-detail-left-identity"
      >
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <UserIcon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex gap-1">
              <InlineEditField
                value={contact.firstName}
                onSave={saveField("firstName")}
                ariaLabel="First name"
                className="font-semibold"
              />
              <InlineEditField
                value={contact.lastName}
                onSave={saveField("lastName")}
                ariaLabel="Last name"
                className="font-semibold"
              />
            </div>
            {companyName && (
              <p className="text-xs text-[var(--color-muted-foreground)]">{companyName}</p>
            )}
          </div>
        </div>

        <Row icon={<Mail className="size-3.5" aria-hidden="true" />} label="Email">
          <InlineEditField
            value={contact.primaryEmail}
            onSave={saveField("primaryEmail")}
            type="email"
            ariaLabel="Primary email"
          />
        </Row>

        <Row icon={<Phone className="size-3.5" aria-hidden="true" />} label="Phone">
          <InlineEditField
            value={contact.primaryPhone}
            onSave={saveField("primaryPhone")}
            type="tel"
            ariaLabel="Primary phone"
          />
        </Row>
      </section>

      {/* Action row */}
      <section className="flex flex-wrap gap-2" data-testid="contact-detail-left-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setNoteOpen(true)
          }}
        >
          <Plus className="mr-1 size-3" aria-hidden="true" />
          Add note
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setCallOpen(true)
          }}
        >
          <Plus className="mr-1 size-3" aria-hidden="true" />
          Log call
        </Button>
      </section>

      {/* About panel */}
      <section
        className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-sm"
        data-testid="contact-detail-left-about"
      >
        <h2 className="text-sm font-semibold">About</h2>
        <AboutRow label="Type" value={contact.contactType} />
        <AboutRow label="Lifecycle" value={contact.lifecycleStatus} />
        <AboutRow label="Lead source" value={contact.leadSource} />
        <AboutRow label="Owner" value={owner?.name ?? owner?.email ?? null} />
      </section>

      <AddNoteModal
        open={noteOpen}
        onClose={() => {
          setNoteOpen(false)
        }}
        contactId={contact.id}
      />
      <LogCallModal
        open={callOpen}
        onClose={() => {
          setCallOpen(false)
        }}
        contactId={contact.id}
      />
    </aside>
  )
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex size-5 shrink-0 items-center justify-center text-[var(--color-muted-foreground)]">
        {icon}
      </span>
      <span className="sr-only">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function AboutRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 text-xs">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className={cn(!value && "text-[var(--color-muted-foreground)]")}>{value ?? "—"}</span>
    </div>
  )
}
