import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { getInvitationById } from "@/modules/org/queries"
import { AcceptInviteRunner } from "@/modules/org/ui/accept-invite-runner"
import { Alert, AlertDescription } from "@/components/ui/alert"

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invitation = await getInvitationById(token)

  if (invitation?.status !== "pending") {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Invitation</h1>
        <Alert variant="destructive">
          <AlertDescription>
            This invitation is invalid, expired, or has already been used.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const session = await getSession()
  if (!session?.user) {
    // Push 2c.6.8 — propagate the invited email through to sign-in
    // so the form can pre-fill + lock it. This is the steering wheel:
    // the user lands on sign-in with the right email pre-selected,
    // less chance of creating an account with the wrong address.
    const params = new URLSearchParams({
      redirect: `/accept-invite/${token}`,
      email: invitation.email,
    })
    redirect(`/sign-in?${params.toString()}`)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Join {invitation.organizationName}</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          You&apos;ve been invited to join <strong>{invitation.organizationName}</strong> on
          Pathway. This invitation was sent to <strong>{invitation.email}</strong>.
        </p>
      </div>
      <AcceptInviteRunner
        invitationId={token}
        invitedEmail={invitation.email}
        currentUserEmail={session.user.email}
      />
    </div>
  )
}
