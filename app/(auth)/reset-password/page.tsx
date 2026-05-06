import { Suspense } from "react"
import { ResetPasswordForm } from "@/modules/auth/ui/reset-password-form"

export default function ResetPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Set a new password</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
