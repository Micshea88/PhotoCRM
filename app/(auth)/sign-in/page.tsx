import Link from "next/link"
import { Suspense } from "react"
import { SignInForm } from "@/modules/auth/ui/sign-in-form"
import { AuthPageHeader, SignInBottomLinks } from "@/modules/auth/ui/auth-page-header"

export default function SignInPage() {
  return (
    <div className="space-y-6">
      {/* Push 2c.6.11 — heading + bottom links are client sub-
       * components that read `?redirect=` to detect invite flow.
       * Suspense wraps both because useSearchParams requires it
       * in Next 16 static-rendered pages. */}
      <Suspense
        fallback={
          <div className="space-y-2 text-center">
            <h1 className="font-serif text-2xl font-semibold">Welcome back</h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Sign in to your Pathway account
            </p>
          </div>
        }
      >
        <AuthPageHeader
          defaultTitle="Welcome back"
          defaultSubtitle="Sign in to your Pathway account"
          inviteTitle="Sign in to accept your invitation"
          inviteSubtitle="Sign in to join the organization that invited you."
        />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>}>
        <SignInForm />
      </Suspense>
      <Suspense fallback={null}>
        <SignInBottomLinks>
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
        </SignInBottomLinks>
      </Suspense>
    </div>
  )
}
