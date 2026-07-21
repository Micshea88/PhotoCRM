/** A thin "or" separator between social sign-in and the email/password form. */
export function AuthOrDivider() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="text-xs text-[var(--color-muted-foreground)]">or</span>
      <div className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  )
}
