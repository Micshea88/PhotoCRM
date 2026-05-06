import Link from "next/link"
import { Suspense } from "react"
import { SignInForm } from "@/modules/auth/ui/sign-in-form"

export default function SignInPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Sign in to your Pathway account
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>}>
        <SignInForm />
      </Suspense>
      <div className="space-y-2 text-center text-sm">
        <Link
          href="/forgot-password"
          className="text-[var(--color-muted-foreground)] hover:underline"
        >
          Forgot password?
        </Link>
        <p className="text-[var(--color-muted-foreground)]">
          New here?{" "}
          <Link href="/sign-up" className="font-medium underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}
