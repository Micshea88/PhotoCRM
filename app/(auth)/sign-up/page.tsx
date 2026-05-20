import Link from "next/link"
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
      <SignUpForm />
      <p className="text-center text-sm text-[var(--color-muted-foreground)]">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
