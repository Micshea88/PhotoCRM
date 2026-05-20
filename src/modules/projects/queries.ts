import "server-only"
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm"
import { withOrgContext } from "@/lib/org-context"
import { projects, projectContacts, projectPhotographers, projectSubEvents } from "./schema"

interface ListOptions {
  withDeleted?: boolean
}

export async function listProjectsForOrg(opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(projects)
      .where(opts.withDeleted ? undefined : isNull(projects.deletedAt))
      .orderBy(projects.primaryDate, projects.name)
  })
}

/**
 * Single project + all three relations: roled contacts, photographer
 * assignments, sub-events. Four small queries rather than one heavy
 * join — the detail view renders all four sections and any single
 * round-trip vs. parallelism is a Phase 4 polish decision.
 */
export async function getProjectForOrg(id: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(projects.id, id)
      : and(eq(projects.id, id), isNull(projects.deletedAt))
    const [project] = await tx.select().from(projects).where(where).limit(1)
    if (!project) return null
    const [contactRows, photographerRows, subEventRows] = await Promise.all([
      tx.select().from(projectContacts).where(eq(projectContacts.projectId, id)),
      tx.select().from(projectPhotographers).where(eq(projectPhotographers.projectId, id)),
      tx.select().from(projectSubEvents).where(eq(projectSubEvents.projectId, id)),
    ])
    return {
      project,
      contacts: contactRows,
      photographers: photographerRows,
      subEvents: subEventRows,
    }
  })
}

export async function listProjectsByLifecycle(lifecycleStatus: string, opts: ListOptions = {}) {
  return withOrgContext(async (tx) => {
    const where = opts.withDeleted
      ? eq(projects.lifecycleStatus, lifecycleStatus)
      : and(eq(projects.lifecycleStatus, lifecycleStatus), isNull(projects.deletedAt))
    return tx.select().from(projects).where(where).orderBy(projects.primaryDate)
  })
}

/**
 * All projects a given user is assigned to (any role). Used by the
 * assignment-scoped views (My Events, Team This Week) and by the
 * future assignment-scoped RLS policy on contacts (Phase 4).
 */
export async function listProjectsByPhotographer(userId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select({ project: projects, assignment: projectPhotographers })
      .from(projectPhotographers)
      .innerJoin(projects, eq(projects.id, projectPhotographers.projectId))
      .where(and(eq(projectPhotographers.userId, userId), isNull(projects.deletedAt)))
      .orderBy(projects.primaryDate)
  })
}

export async function getProjectContactsByRole(projectId: string, role: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.role, role)))
  })
}

/**
 * Dashboard widget — count of projects whose `primaryDate` falls within
 * the (inclusive) window [startISO, endISO]. Date inputs are plain
 * YYYY-MM-DD strings; NO Date constructor (Module 14b discipline +
 * LOC1's "no timezone library" rule). Soft-deleted rows excluded.
 * RLS-scoped via withOrgContext. Lands as part of P4-queries ahead of
 * the P4.1 dashboard's "Projects this month" widget.
 */
export async function countProjectsInDateRange(startISO: string, endISO: string): Promise<number> {
  return withOrgContext(async (tx) => {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(
        and(
          gte(projects.primaryDate, startISO),
          lte(projects.primaryDate, endISO),
          isNull(projects.deletedAt),
        ),
      )
    return row?.count ?? 0
  })
}

export async function getProjectSubEvents(projectId: string) {
  return withOrgContext(async (tx) => {
    return tx
      .select()
      .from(projectSubEvents)
      .where(eq(projectSubEvents.projectId, projectId))
      .orderBy(projectSubEvents.eventDate)
  })
}
