import { redirect } from "next/navigation"
import Link from "next/link"
import { getSession } from "@/modules/auth/session"
import { Button } from "@/components/ui/button"
import { ContactsImportWizard } from "@/modules/contacts/ui/contacts-import-wizard"

export const dynamic = "force-dynamic"

export default async function ContactsImportPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Import contacts</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Upload a CSV (max 10,000 rows). We&apos;ll match against existing contacts by email,
            then phone, and let you confirm each action before importing.
          </p>
        </div>
        <Link href="/contacts">
          <Button variant="outline">Cancel</Button>
        </Link>
      </div>
      <ContactsImportWizard />
    </div>
  )
}
