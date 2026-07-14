import { Suspense } from "react"
import { VerifyEmailRunner } from "@/modules/auth/ui/verify-email-runner"

export default function VerifyEmailPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-serif text-2xl font-semibold">Verifying your email</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>}>
        <VerifyEmailRunner />
      </Suspense>
    </div>
  )
}
