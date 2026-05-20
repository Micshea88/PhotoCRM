import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { countOpenOpportunities } from "@/modules/opportunities/queries"
import { countProjectsInDateRange } from "@/modules/projects/queries"
import { listTasksByDueDateRange } from "@/modules/tasks/queries"
import { getDefaultSavedView } from "@/modules/saved-views/queries"
import { getUserOrganizations } from "@/modules/org/queries"
import { resolveCurrentMonthRange, resolveSundaySaturdayWeek, todayISO } from "@/lib/format"
import { WelcomeHeader } from "@/modules/dashboard/ui/welcome-header"
import { CountCard } from "@/modules/dashboard/ui/count-card"
import { TeamThisWeek } from "@/modules/dashboard/ui/team-this-week"
import { TasksDueList } from "@/modules/dashboard/ui/tasks-due-list"

/**
 * Dashboard landing page — five widgets, all data flowing through the
 * P4-queries helpers on existing queries.ts. RLS is set up by the
 * layout (Module 14a plumbing); these reads inherit it via
 * `withOrgContext` inside each helper.
 *
 * Per LOC1 (US-only, Sunday-Saturday week), the Team This Week +
 * tasks-due widgets resolve their window in UTC via
 * `resolveSundaySaturdayWeek`. Per-studio timezone is a deferred
 * decision.
 */
export default async function DashboardPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const today = todayISO()
  const monthRange = resolveCurrentMonthRange(today)
  const weekRange = resolveSundaySaturdayWeek(today)

  const [openOpps, projectsThisMonth, weekTasks, defaultTeamView, organizations] =
    await Promise.all([
      countOpenOpportunities(),
      countProjectsInDateRange(monthRange.startISO, monthRange.endISO),
      listTasksByDueDateRange(weekRange.startISO, weekRange.endISO, { limit: 100 }),
      getDefaultSavedView("task"),
      getUserOrganizations(session.user.id),
    ])

  const activeOrg = organizations.find((o) => o.id === orgId)
  const studioName = activeOrg?.name ?? "your studio"
  const userFirstName = session.user.name.split(" ")[0] ?? session.user.name

  return (
    <div className="space-y-6">
      <WelcomeHeader userFirstName={userFirstName} studioName={studioName} />

      <div className="grid gap-4 sm:grid-cols-3">
        <CountCard
          label="Open opportunities"
          count={openOpps}
          hint={openOpps === 0 ? "Log an inquiry to start your pipeline." : undefined}
        />
        <CountCard
          label="Projects this month"
          count={projectsThisMonth}
          hint={
            projectsThisMonth === 0 ? "No events on the calendar for this month yet." : undefined
          }
        />
        <CountCard
          label="Tasks due this week"
          count={weekTasks.length}
          hint={weekTasks.length === 0 ? "Add a task with a due date this week." : undefined}
        />
      </div>

      <TeamThisWeek
        tasks={weekTasks.map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: t.dueDate,
          assigneeUserId: t.assigneeUserId,
        }))}
        hasSeedView={defaultTeamView !== null}
      />

      <TasksDueList
        totalCount={weekTasks.length}
        topTasks={weekTasks.slice(0, 3).map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: t.dueDate,
        }))}
      />
    </div>
  )
}
