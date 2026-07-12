import Link from "next/link"
import { ForgotPasswordForm } from "@/modules/auth/ui/forgot-password-form"

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-serif text-2xl font-semibold">Reset password</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          We&apos;ll email you a link to set a new one.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="text-center text-sm text-[var(--color-muted-foreground)]">
        <Link href="/sign-in" className="font-medium underline">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
