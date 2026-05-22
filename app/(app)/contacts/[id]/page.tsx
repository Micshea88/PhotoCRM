import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { runWithOrgContext } from "@/lib/org-context"
import { getSession } from "@/modules/auth/session"
import { getCurrentMember, getOrganizationMembers } from "@/modules/org/queries"
import { getExtendedMemberRole } from "@/modules/rbac/queries"
import { extendedFromBetterAuth, type BetterAuthRole } from "@/modules/rbac/types"
import { getContactForOrg, listContactCompanyAssociations } from "@/modules/contacts/queries"
import { listFieldDefinitionsForRecordType } from "@/modules/custom-fields/queries"
import { contactLabel } from "@/modules/contacts/display"
import { formatPhoneDisplay } from "@/lib/format/phone"
import { ContactTabs } from "@/modules/contacts/ui/contact-tabs"
import { DeleteContactButton } from "@/modules/contacts/ui/delete-contact-button"
import { ArchiveContactButton } from "@/modules/contacts/ui/archive-contact-button"
import { Button } from "@/components/ui/button"

interface MailingAddressView {
  street1?: string
  street2?: string
  city?: string
  state?: string
  zip?: string
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const member = await getCurrentMember(orgId, session.user.id)
  const baRole = (member?.role ?? "member") as BetterAuthRole
  const tentativeRole = extendedFromBetterAuth(baRole)

  const data = await runWithOrgContext(
    { orgId, role: tentativeRole, userId: session.user.id },
    async () => {
      const extended = (await getExtendedMemberRole(session.user.id)) ?? tentativeRole
      return runWithOrgContext({ orgId, role: extended, userId: session.user.id }, async () => {
        const row = await getContactForOrg(id)
        if (!row) return null
        const [associations, customFieldDefs, referredByRow] = await Promise.all([
          listContactCompanyAssociations(id),
          listFieldDefinitionsForRecordType("contact"),
          row.contact.referredByContactId
            ? getContactForOrg(row.contact.referredByContactId)
            : Promise.resolve(null),
        ])
        return { row, associations, customFieldDefs, referredByRow }
      })
    },
  )

  if (!data) notFound()
  const { row, associations, customFieldDefs, referredByRow } = data
  const { contact, company } = row

  const orgMembers = await getOrganizationMembers(orgId)
  const owner = orgMembers.find((m) => m.user.id === contact.ownerUserId)?.user

  const address = (contact.mailingAddress ?? {}) as MailingAddressView
  const hasAddress = !!address.street1 || !!address.city || !!address.state || !!address.zip

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/contacts"
            className="text-xs text-[var(--color-muted-foreground)] hover:underline"
          >
            ← Contacts
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            {contactLabel(
              {
                firstName: contact.firstName,
                lastName: contact.lastName,
                primaryEmail: contact.primaryEmail,
              },
              company?.name,
            )}
          </h1>
          {contact.contactType && (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {contact.contactType}
              {contact.lifecycleStatus ? ` · ${contact.lifecycleStatus}` : ""}
            </p>
          )}
          {contact.archivedAt && (
            <span className="mt-2 inline-block rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)]">
              Archived
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/contacts/${contact.id}/edit`}>
            <Button type="button" variant="outline" size="sm">
              Edit
            </Button>
          </Link>
          {!contact.archivedAt && <ArchiveContactButton id={contact.id} />}
          <DeleteContactButton id={contact.id} />
        </div>
      </div>

      <ContactTabs
        overview={
          <OverviewPane
            contact={contact}
            company={company}
            owner={owner ?? null}
            referredBy={referredByRow ? referredByRow.contact : null}
            customFieldDefs={customFieldDefs}
            address={address}
            hasAddress={hasAddress}
          />
        }
        companies={<CompaniesPane primaryCompany={company} associations={associations} />}
        events={<EmptyPane label="No events yet. Events module ships in a later push." />}
        tasks={<EmptyPane label="No tasks yet. Tasks module ships in a later push." />}
        activity={
          <EmptyPane label="Activity feed ships in PUSH 3 — notes, calls, and audit-derived events." />
        }
      />
    </div>
  )
}

type ContactRow = NonNullable<Awaited<ReturnType<typeof getContactForOrg>>>

function OverviewPane({
  contact,
  company,
  owner,
  referredBy,
  customFieldDefs,
  address,
  hasAddress,
}: {
  contact: ContactRow["contact"]
  company: ContactRow["company"]
  owner: { id: string; name: string | null; email: string } | null
  referredBy: ContactRow["contact"] | null
  customFieldDefs: Awaited<ReturnType<typeof listFieldDefinitionsForRecordType>>
  address: MailingAddressView
  hasAddress: boolean
}) {
  const customFields = contact.customFields ?? {}

  return (
    <div className="space-y-6">
      <Section title="Communication">
        <FieldRow label="Primary email" value={contact.primaryEmail} />
        <FieldRow label="Secondary email" value={contact.secondaryEmail} />
        <FieldRow label="Primary phone" value={formatPhoneDisplay(contact.primaryPhone)} />
        <FieldRow label="Secondary phone" value={formatPhoneDisplay(contact.secondaryPhone)} />
      </Section>

      <Section title="Address">
        {!hasAddress ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No mailing address.</p>
        ) : (
          <div className="space-y-1 text-sm">
            {address.street1 && <div>{address.street1}</div>}
            {address.street2 && <div>{address.street2}</div>}
            <div>{[address.city, address.state, address.zip].filter(Boolean).join(", ")}</div>
          </div>
        )}
      </Section>

      <div className="space-y-2 px-4">
        <FieldRow label="Date of birth" value={contact.dob} />
        <FieldRow label="Anniversary" value={contact.anniversaryDate} />
      </div>

      <Section title="Social profiles">
        <FieldRow label="Instagram handle" value={contact.instagramHandle} />
        <FieldRow label="Facebook URL" value={contact.facebookUrl} />
        <FieldRow label="Website" value={contact.website} />
      </Section>

      <Section title="Lead generation">
        <FieldRow label="Lead source" value={contact.leadSource} />
        <FieldRow
          label="Referred by"
          value={referredBy ? `${referredBy.firstName} ${referredBy.lastName}` : null}
        />
        <FieldRow label="Contact type" value={contact.contactType} />
        <FieldRow label="Lifecycle status" value={contact.lifecycleStatus} />
        <FieldRow label="Tags" value={(contact.tags ?? []).join(", ") || null} />
        <FieldRow label="Owner" value={owner?.name ?? owner?.email ?? null} />
        <FieldRow label="Primary company" value={company?.name ?? null} />
      </Section>

      <Section title="Notes">
        <FieldBlock label="Notes" value={contact.notes} />
        <FieldBlock label="Internal notes" value={contact.internalNotes} />
      </Section>

      {customFieldDefs.length > 0 && (
        <Section title="Custom fields">
          {customFieldDefs.map((def) => (
            <FieldRow
              key={def.id}
              label={def.name}
              value={renderCustomFieldValue(customFields[def.id])}
            />
          ))}
        </Section>
      )}
    </div>
  )
}

function CompaniesPane({
  primaryCompany,
  associations,
}: {
  primaryCompany: ContactRow["company"]
  associations: Awaited<ReturnType<typeof listContactCompanyAssociations>>
}) {
  if (!primaryCompany && associations.length === 0) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">No companies linked yet.</p>
  }
  return (
    <div className="space-y-4">
      {primaryCompany && (
        <div>
          <div className="text-xs text-[var(--color-muted-foreground)]">Primary</div>
          <div className="font-medium">{primaryCompany.name}</div>
        </div>
      )}
      {associations.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-[var(--color-muted-foreground)]">Additional</div>
          <ul className="space-y-1">
            {associations.map(({ association, company }) => (
              <li key={association.id} className="text-sm">
                <span className="font-medium">{company.name}</span>
                {association.role && (
                  <span className="text-[var(--color-muted-foreground)]">
                    {" "}
                    — {association.role}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function EmptyPane({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] p-10 text-center">
      <p className="text-sm text-[var(--color-muted-foreground)]">{label}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 text-sm">
      <div className="text-[var(--color-muted-foreground)]">{label}</div>
      <div>
        {value && value !== "" ? (
          value
        ) : (
          <span className="text-[var(--color-muted-foreground)]">—</span>
        )}
      </div>
    </div>
  )
}

function FieldBlock({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="text-sm">
      <div className="mb-1 text-[var(--color-muted-foreground)]">{label}</div>
      <div className="whitespace-pre-wrap">
        {value && value !== "" ? (
          value
        ) : (
          <span className="text-[var(--color-muted-foreground)]">—</span>
        )}
      </div>
    </div>
  )
}

function renderCustomFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value || null
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.join(", ") || null
  return JSON.stringify(value)
}
