import Link from "next/link"
import { Suspense } from "react"
import { SignUpForm } from "@/modules/auth/ui/sign-up-form"
import { AuthPageHeader } from "@/modules/auth/ui/auth-page-header"

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      {/* Push 2c.6.11 — invite-flow-aware heading. AuthPageHeader
       * reads `?redirect=/accept-invite/...` and swaps copy
       * accordingly. The bottom static "Already have an account?
       * Sign in" cross-link stays — sign-up-form already has its
       * own in-form version that propagates email + redirect, and
       * the page-bottom one is harmless because it doesn't strip
       * any lock (the URL doesn't carry an email lock at this
       * stage of the flow). */}
      <Suspense
        fallback={
          <div className="space-y-2 text-center">
            <h1 className="font-serif text-2xl font-semibold">Create your studio account</h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Start running your studio in seconds.
            </p>
          </div>
        }
      >
        <AuthPageHeader
          defaultTitle="Create your studio account"
          defaultSubtitle="Start running your studio in seconds."
          inviteTitle="Create your account to accept your invitation"
          inviteSubtitle="Create an account to join the organization that invited you."
        />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>}>
        <SignUpForm />
      </Suspense>
      <p className="text-center text-sm text-[var(--color-muted-foreground)]">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
