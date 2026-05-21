import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"

export default async function ContactsTrashPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  if (!session.session.activeOrganizationId) redirect("/onboarding/create-organization")

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/contacts"
          className="text-xs text-[var(--color-muted-foreground)] hover:underline"
        >
          ← Contacts
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Trash</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Soft-deleted contacts. Restore with one click or wait 90 days for permanent purge.
        </p>
      </div>
      <div className="rounded-lg border border-dashed border-[var(--color-border)] p-10 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Bulk-restore UI ships in PUSH 4. For now, the backend keeps every deleted contact
          recoverable — re-creation isn&apos;t needed.
        </p>
      </div>
    </div>
  )
}
