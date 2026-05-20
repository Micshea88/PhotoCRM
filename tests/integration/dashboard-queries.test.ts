/**
 * P4-queries — four small additive read helpers that the P4.1 dashboard
 * will consume:
 *
 *   - countOpenOpportunities()                 (opportunities/queries.ts)
 *   - countProjectsInDateRange(start, end)     (projects/queries.ts)
 *   - listTasksByDueDateRange(start, end, ?)   (tasks/queries.ts)
 *   - getDefaultSavedView(objectType)          (saved-views/queries.ts)
 *
 * Each test exercises the SAME SQL shape the helper uses, run on the
 * test's transactional Pool (the BEGIN/ROLLBACK envelope that
 * `withTestDb` provides). The helper itself runs through
 * `withOrgContext` which opens its OWN transaction via the global db
 * pool — we don't invoke the helpers directly here because doing so
 * would bypass the test transaction's rollback envelope and leak data.
 * Mirroring the SQL inline is the same posture every prior RLS test
 * in this repo takes (see assignment-scoped-rls.test.ts,
 * payment-installments-rls.test.ts).
 *
 * Per test: a cross-org isolation case (Studio A's data invisible to
 * Studio B) + at least one edge case (filter / range bound / default
 * row matching).
 */
import { describe, it, expect } from "vitest"
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { opportunities } from "@/modules/opportunities/schema"
import { pipelines, pipelineStages } from "@/modules/pipelines/schema"
import { projects } from "@/modules/projects/schema"
import { tasks } from "@/modules/tasks/schema"
import { savedViews } from "@/modules/saved-views/schema"
import { seedDefaultSavedViewsForOrg } from "@/modules/saved-views/seed"

async function seedTwoOrgsAsOwner(db: Parameters<Parameters<typeof withTestDb>[0]>[0]) {
  const userA = await createUser(db)
  const orgA = await createOrganization(db, userA)
  const userB = await createUser(db)
  const orgB = await createOrganization(db, userB)
  // Start each test pointed at org A as owner; tests switch to org B
  // when probing for isolation.
  await setOrgContext(db, orgA, "owner", userA)
  return { orgA, userA, orgB, userB }
}

async function seedPipelineAndStage(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  orgId: string,
) {
  const pipelineId = createId()
  await db.insert(pipelines).values({
    id: pipelineId,
    organizationId: orgId,
    name: `Pipeline ${pipelineId.slice(0, 6)}`,
    type: "wedding",
  })
  const stageId = createId()
  await db.insert(pipelineStages).values({
    id: stageId,
    organizationId: orgId,
    pipelineId,
    name: "Inquiry",
    order: 0,
  })
  return { pipelineId, stageId }
}

async function seedProject(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  orgId: string,
  overrides: { primaryDate?: string | null; name?: string } = {},
) {
  const projectId = createId()
  await db.insert(projects).values({
    id: projectId,
    organizationId: orgId,
    name: overrides.name ?? `Project ${projectId.slice(0, 6)}`,
    primaryDate: overrides.primaryDate ?? null,
  })
  return projectId
}

// ─── countOpenOpportunities ──────────────────────────────────────────

describe("countOpenOpportunities — cross-org isolation", () => {
  it("Studio A's open opportunities are invisible to Studio B's probe", async () => {
    await withTestDb(async (db) => {
      const env = await seedTwoOrgsAsOwner(db)

      // Org A: seed pipeline + project + one OPEN opportunity.
      const { pipelineId: pipelineA, stageId: stageA } = await seedPipelineAndStage(db, env.orgA)
      const projectA = await seedProject(db, env.orgA)
      await db.insert(opportunities).values({
        id: createId(),
        organizationId: env.orgA,
        projectId: projectA,
        pipelineId: pipelineA,
        stageId: stageA,
        status: "open",
      })

      // Probe under org A → 1.
      const [countA] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(opportunities)
        .where(and(eq(opportunities.status, "open"), isNull(opportunities.deletedAt)))
      expect(countA?.count).toBe(1)

      // Switch to org B as owner; probe → 0.
      await setOrgContext(db, env.orgB, "owner", env.userB)
      const [countB] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(opportunities)
        .where(and(eq(opportunities.status, "open"), isNull(opportunities.deletedAt)))
      expect(countB?.count).toBe(0)
    })
  })
})

describe("countOpenOpportunities — status + soft-delete filters", () => {
  it("excludes status='won', status='lost', and soft-deleted rows", async () => {
    await withTestDb(async (db) => {
      const env = await seedTwoOrgsAsOwner(db)
      const { pipelineId, stageId } = await seedPipelineAndStage(db, env.orgA)
      const projectId = await seedProject(db, env.orgA)

      // 1 open, 1 won, 1 lost, 1 open-but-soft-deleted.
      await db.insert(opportunities).values([
        {
          id: createId(),
          organizationId: env.orgA,
          projectId,
          pipelineId,
          stageId,
          status: "open",
        },
        {
          id: createId(),
          organizationId: env.orgA,
          projectId,
          pipelineId,
          stageId,
          status: "won",
        },
        {
          id: createId(),
          organizationId: env.orgA,
          projectId,
          pipelineId,
          stageId,
          status: "lost",
        },
        {
          id: createId(),
          organizationId: env.orgA,
          projectId,
          pipelineId,
          stageId,
          status: "open",
          deletedAt: new Date(),
        },
      ])

      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(opportunities)
        .where(and(eq(opportunities.status, "open"), isNull(opportunities.deletedAt)))
      expect(row?.count).toBe(1)
    })
  })
})

// ─── countProjectsInDateRange ────────────────────────────────────────

describe("countProjectsInDateRange — cross-org isolation", () => {
  it("Studio A's projects in-range are invisible to Studio B's probe", async () => {
    await withTestDb(async (db) => {
      const env = await seedTwoOrgsAsOwner(db)
      await seedProject(db, env.orgA, { primaryDate: "2026-05-15" })

      const probeOrgA = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(
          and(
            gte(projects.primaryDate, "2026-05-01"),
            lte(projects.primaryDate, "2026-05-31"),
            isNull(projects.deletedAt),
          ),
        )
      expect(probeOrgA[0]?.count).toBe(1)

      await setOrgContext(db, env.orgB, "owner", env.userB)
      const probeOrgB = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(
          and(
            gte(projects.primaryDate, "2026-05-01"),
            lte(projects.primaryDate, "2026-05-31"),
            isNull(projects.deletedAt),
          ),
        )
      expect(probeOrgB[0]?.count).toBe(0)
    })
  })
})

describe("countProjectsInDateRange — bounds inclusive; out-of-range and soft-deleted excluded", () => {
  it("counts on the exact boundary dates and excludes outside + soft-deleted", async () => {
    await withTestDb(async (db) => {
      const env = await seedTwoOrgsAsOwner(db)

      // Inside, on each bound, outside, and one inside-but-soft-deleted.
      await seedProject(db, env.orgA, { primaryDate: "2026-05-01", name: "lower-bound" })
      await seedProject(db, env.orgA, { primaryDate: "2026-05-31", name: "upper-bound" })
      await seedProject(db, env.orgA, { primaryDate: "2026-05-15", name: "interior" })
      await seedProject(db, env.orgA, { primaryDate: "2026-04-30", name: "below" })
      await seedProject(db, env.orgA, { primaryDate: "2026-06-01", name: "above" })

      // Soft-delete one interior row.
      const softDeletedId = await seedProject(db, env.orgA, {
        primaryDate: "2026-05-10",
        name: "soft-deleted",
      })
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, softDeletedId))

      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(
          and(
            gte(projects.primaryDate, "2026-05-01"),
            lte(projects.primaryDate, "2026-05-31"),
            isNull(projects.deletedAt),
          ),
        )
      // lower-bound + upper-bound + interior = 3.
      expect(row?.count).toBe(3)
    })
  })
})

// ─── listTasksByDueDateRange ─────────────────────────────────────────

describe("listTasksByDueDateRange — cross-org isolation", () => {
  it("Studio A's tasks in-range are invisible to Studio B's probe", async () => {
    await withTestDb(async (db) => {
      const env = await seedTwoOrgsAsOwner(db)
      const projectId = await seedProject(db, env.orgA)
      await db.insert(tasks).values({
        id: createId(),
        organizationId: env.orgA,
        projectId,
        title: "Pay attention",
        dueDate: "2026-05-20",
      })

      const rowsA = await db
        .select()
        .from(tasks)
        .where(
          and(
            gte(tasks.dueDate, "2026-05-17"),
            lte(tasks.dueDate, "2026-05-23"),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(tasks.dueDate)
        .limit(100)
      expect(rowsA.length).toBe(1)

      await setOrgContext(db, env.orgB, "owner", env.userB)
      const rowsB = await db
        .select()
        .from(tasks)
        .where(
          and(
            gte(tasks.dueDate, "2026-05-17"),
            lte(tasks.dueDate, "2026-05-23"),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(tasks.dueDate)
        .limit(100)
      expect(rowsB.length).toBe(0)
    })
  })
})

describe("listTasksByDueDateRange — ordering and limit", () => {
  it("returns tasks ordered by dueDate asc and respects limit", async () => {
    await withTestDb(async (db) => {
      const env = await seedTwoOrgsAsOwner(db)
      const projectId = await seedProject(db, env.orgA)
      // Seed five tasks within the same week, dueDate scattered.
      const dates = ["2026-05-20", "2026-05-17", "2026-05-22", "2026-05-18", "2026-05-21"]
      for (const dueDate of dates) {
        await db.insert(tasks).values({
          id: createId(),
          organizationId: env.orgA,
          projectId,
          title: `Task due ${dueDate}`,
          dueDate,
        })
      }

      const rows = await db
        .select()
        .from(tasks)
        .where(
          and(
            gte(tasks.dueDate, "2026-05-17"),
            lte(tasks.dueDate, "2026-05-23"),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(tasks.dueDate)
        .limit(3)
      expect(rows.length).toBe(3)
      expect(rows.map((r) => r.dueDate)).toEqual(["2026-05-17", "2026-05-18", "2026-05-20"])
    })
  })
})

// ─── getDefaultSavedView ─────────────────────────────────────────────

describe("getDefaultSavedView — returns the seeded default", () => {
  it("returns the Team This Week view for an org that was seeded", async () => {
    await withTestDb(async (db) => {
      const env = await seedTwoOrgsAsOwner(db)
      await seedDefaultSavedViewsForOrg(db, env.orgA)

      const [row] = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.objectType, "task"),
            eq(savedViews.isDefault, true),
            isNull(savedViews.ownerUserId),
            isNull(savedViews.deletedAt),
          ),
        )
        .limit(1)
      expect(row).toBeTruthy()
      expect(row?.name).toBe("Team This Week")
      expect(row?.shared).toBe(true)
    })
  })
})

describe("getDefaultSavedView — returns null for an unseeded org", () => {
  it("Studio B (unseeded) sees no default for objectType='task'", async () => {
    await withTestDb(async (db) => {
      const env = await seedTwoOrgsAsOwner(db)
      // Seed org A only.
      await seedDefaultSavedViewsForOrg(db, env.orgA)

      // Switch RLS to org B as owner; probe.
      await setOrgContext(db, env.orgB, "owner", env.userB)
      const rows = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.objectType, "task"),
            eq(savedViews.isDefault, true),
            isNull(savedViews.ownerUserId),
            isNull(savedViews.deletedAt),
          ),
        )
        .limit(1)
      expect(rows.length).toBe(0)
    })
  })

  it("returns null when no default exists for the requested objectType", async () => {
    await withTestDb(async (db) => {
      const env = await seedTwoOrgsAsOwner(db)
      await seedDefaultSavedViewsForOrg(db, env.orgA)
      // V1 only seeds objectType="task". Probing for a different type
      // should miss the default.
      const rows = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.objectType, "contact"),
            eq(savedViews.isDefault, true),
            isNull(savedViews.ownerUserId),
            isNull(savedViews.deletedAt),
          ),
        )
        .limit(1)
      expect(rows.length).toBe(0)
    })
  })
})
