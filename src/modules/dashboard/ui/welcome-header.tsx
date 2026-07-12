export interface WelcomeHeaderProps {
  userFirstName: string
  studioName: string
}

/**
 * Welcome line shown at the top of the dashboard. Per LOC1, plain
 * conversational phrasing; the studio name comes from the active
 * organization in the layout context.
 */
export function WelcomeHeader({ userFirstName, studioName }: WelcomeHeaderProps) {
  return (
    <header className="space-y-1">
      <h1 className="font-serif text-2xl font-semibold">
        Welcome, {userFirstName} — {studioName}
      </h1>
      <p className="text-sm text-[var(--color-muted-foreground)]">
        Here&rsquo;s what&rsquo;s happening at your studio this week.
      </p>
    </header>
  )
}
