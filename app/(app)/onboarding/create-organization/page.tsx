import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { getPendingInvitationsForEmail } from "@/modules/org/queries"
import { CreateOrganizationForm } from "@/modules/org/ui/create-organization-form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

export default async function CreateOrganizationPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  if (session.session.activeOrganizationId) redirect("/dashboard")

  // Push 2c.6.11 — invite-aware onboarding. A freshly verified
  // invitee shouldn't be silently funneled into creating their own
  // studio (that's the "Create your studio" trap from the audit).
  // If they have a pending invitation matching their email, surface
  // it above the form so they can accept it instead. We do NOT
  // auto-redirect — the user might intentionally want to create
  // their own org despite the invitation. They get to choose.
  const pendingInvitations = await getPendingInvitationsForEmail(session.user.email)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="space-y-6">
        {pendingInvitations.length > 0 && (
          <PendingInvitationsBanner invitations={pendingInvitations} />
        )}
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Create your studio</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {pendingInvitations.length > 0
              ? "Or set up your own studio below."
              : "One last step before you start running your studio."}
          </p>
        </div>
        <CreateOrganizationForm />
      </div>
    </main>
  )
}

function PendingInvitationsBanner({
  invitations,
}: {
  invitations: { id: string; organizationName: string; expiresAt: Date }[]
}) {
  const isSingle = invitations.length === 1
  return (
    <div className="space-y-3">
      <Alert>
        <AlertDescription>
          <p className="font-medium">
            {isSingle
              ? "You have a pending invitation."
              : `You have ${invitations.length.toString()} pending invitations.`}
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Accept an invitation below to join an existing studio, or create your own.
          </p>
        </AlertDescription>
      </Alert>
      <ul className="space-y-2">
        {invitations.map((inv) => (
          <li
            key={inv.id}
            className="flex items-center justify-between rounded-md border border-[var(--color-border)] p-3"
          >
            <div>
              <p className="text-sm font-medium">{inv.organizationName}</p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Expires {inv.expiresAt.toLocaleDateString()}
              </p>
            </div>
            <Button asChild size="sm">
              <Link href={`/accept-invite/${inv.id}`}>Accept</Link>
            </Button>
          </li>
        ))}
      </ul>
      <Separator />
    </div>
  )
}
