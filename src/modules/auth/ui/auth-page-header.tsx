"use client"

import { useSearchParams } from "next/navigation"

/**
 * Push 2c.6.11 — invite-flow-aware page heading.
 *
 * Detection rule (locked): `?redirect=` URL param present AND
 * its value starts with `/accept-invite/`. The presence of
 * `?email=` alone does NOT count — the "account exists"
 * remediation link in sign-up-form adds ?email= for prefill
 * outside the invite context, and that path should keep the
 * regular sign-in heading.
 *
 * Renders one of two copy blocks. The parent page passes both;
 * this component picks based on the URL.
 */
export function AuthPageHeader({
  defaultTitle,
  defaultSubtitle,
  inviteTitle,
  inviteSubtitle,
}: {
  defaultTitle: string
  defaultSubtitle: string
  inviteTitle: string
  inviteSubtitle: string
}) {
  const params = useSearchParams()
  const redirect = params.get("redirect")
  const isInviteFlow = typeof redirect === "string" && redirect.startsWith("/accept-invite/")
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-2xl font-semibold">{isInviteFlow ? inviteTitle : defaultTitle}</h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">
        {isInviteFlow ? inviteSubtitle : defaultSubtitle}
      </p>
    </div>
  )
}

/**
 * Sibling client component for the sign-in page's bottom links area.
 * Suppresses the bare /sign-up Link in the invite flow (that's the
 * dangerous one — strips email + redirect lock from the invite
 * round-trip).
 */
export function SignInBottomLinks({ children }: { children: React.ReactNode }) {
  const params = useSearchParams()
  const redirect = params.get("redirect")
  const isInviteFlow = typeof redirect === "string" && redirect.startsWith("/accept-invite/")
  if (isInviteFlow) return null
  return <>{children}</>
}
