import { MastheadDate } from "./masthead-date"

export interface WelcomeHeaderProps {
  userFirstName: string
  studioName: string
}

/**
 * Dashboard masthead — greeting (left) + live date (top-right), then a clear
 * section break before the KPI cards. Per LOC1, plain conversational phrasing;
 * the studio name comes from the active organization in the layout context.
 * `mb-10` (40px) reserves the header its own zone with air beneath it — it
 * collapses with the page's `space-y-6` (24px) to the larger of the two.
 */
export function WelcomeHeader({ userFirstName, studioName }: WelcomeHeaderProps) {
  return (
    <header className="mb-10 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">
          Welcome, {userFirstName} — {studioName}
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Here&rsquo;s what&rsquo;s happening at your studio this week.
        </p>
      </div>
      <MastheadDate />
    </header>
  )
}
