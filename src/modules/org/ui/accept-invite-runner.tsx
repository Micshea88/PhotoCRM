"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { acceptOrgInvitation } from "@/modules/org/actions"

/**
 * Push 2c.6.8 — client-side runner with explicit email-match
 * pre-flight before invoking the server action.
 *
 *   - Invited email + current session email are passed in by the
 *     server page wrapper. If they don't match (case-insensitive,
 *     trimmed), we refuse to render the Accept button at all and
 *     instead show a clear remediation message + sign-out link.
 *   - Even if a user tampers with this component via devtools, the
 *     server action (acceptOrgInvitation) re-checks server-side
 *     AND Better Auth's accept endpoint re-checks at its boundary
 *     (crud-invites.mjs:246). Defense in depth.
 *   - The Accept button calls acceptOrgInvitation instead of
 *     authClient.organization.acceptInvitation so any future
 *     unhappy-path error gets our friendly message format, not
 *     BA's raw FORBIDDEN.
 */
export function AcceptInviteRunner({
  invitationId,
  invitedEmail,
  currentUserEmail,
}: {
  invitationId: string
  invitedEmail: string
  currentUserEmail: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailMatches = invitedEmail.toLowerCase().trim() === currentUserEmail.toLowerCase().trim()

  async function accept() {
    setSubmitting(true)
    setError(null)
    const result = await acceptOrgInvitation({ invitationId })
    if (result.serverError) {
      setSubmitting(false)
      setError(result.serverError)
      return
    }
    if (!result.data) {
      setSubmitting(false)
      setError("Could not accept invitation. Please try again or contact the inviter.")
      return
    }
    await authClient.organization.setActive({ organizationId: result.data.organizationId })
    setSubmitting(false)
    router.push("/dashboard")
    router.refresh()
  }

  async function signOut() {
    await authClient.signOut()
    router.push(
      `/sign-in?redirect=/accept-invite/${invitationId}&email=${encodeURIComponent(invitedEmail)}`,
    )
    router.refresh()
  }

  if (!emailMatches) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium">This invitation isn&apos;t for this account.</p>
            <p className="mt-2">
              It was sent to <strong>{invitedEmail}</strong>, but you&apos;re currently signed in as{" "}
              <strong>{currentUserEmail}</strong>.
            </p>
            <p className="mt-2">
              Sign out and sign in with {invitedEmail}, or ask the inviter to send a new invitation
              to {currentUserEmail}.
            </p>
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button onClick={() => void signOut()} variant="outline" className="flex-1">
            Sign out
          </Button>
          <Button asChild className="flex-1">
            <Link href="/dashboard">Stay signed in</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-[var(--color-muted-foreground)]">
        Accepting as <strong>{currentUserEmail}</strong>.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button onClick={() => void accept()} disabled={submitting} className="w-full">
        {submitting ? "Accepting…" : "Accept invitation"}
      </Button>
    </div>
  )
}
