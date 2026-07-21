import { PASSWORD_REQUIREMENTS } from "@/modules/auth/password-policy"

/** Shows the password rules under a new-password field (policy #11: "requirements
 *  shown in the UI"). Used on sign-up, reset, and account password-change. */
export function PasswordRequirementsHint() {
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-xs text-[var(--color-muted-foreground)]">
      {PASSWORD_REQUIREMENTS.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  )
}
