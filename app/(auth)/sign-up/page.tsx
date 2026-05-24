import Link from "next/link"
import { Suspense } from "react"
import { SignUpForm } from "@/modules/auth/ui/sign-up-form"

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Create your studio account</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Start running your studio in seconds.
        </p>
      </div>
      {/* Push 2c.6.8 — SignUpForm reads `?email=` via useSearchParams
       * to pre-fill + lock the email when arriving from an invitation
       * accept flow. useSearchParams requires Suspense in Next 16. */}
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
