/**
 * Contact Tasks build — DB-level guarantees:
 *   1. The tasks CHECK (project_id OR contact_id) — all three valid states
 *      insert; the both-null state is rejected.
 *   2. RLS on contact-scoped tasks under the view_all_events flag (migration
 *      0047): a team member sees a contact-only task only when they're its
 *      direct assignee (carve-out) at view_all=false, and sees all at
 *      view_all=true. Org isolation unaffected.
 *
 * Raw-pg, app layer bypassed (same harness as assignment-scoped-rls.test.ts) —
 * proves the DATABASE enforces these, not the app's where-clauses. Project-
 * scoped task behavior is covered by assignment-scoped-rls.test.ts; here we
 * add the contact-scoped counterpart.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

interface Scenario {
  orgId: string
  ownerUserId: string
  teamUserId: string
  contactId: string
  // contact-only task assigned directly to the team member
  taskContactAssignedId: string
  // contact-only task with no assignee
  taskContactUnassignedId: string
}

async function seed(client: PoolClient): Promise<Scenario> {
  const orgId = createId()
  const ownerUserId = createId()
  const teamUserId = createId()

  await client.query(
    `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, 'Org', $2, NOW())`,
    [orgId, `org-${orgId.slice(0, 8)}`],
  )
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Owner', $2, true, NOW(), NOW()), ($3, 'Team', $4, true, NOW(), NOW())`,
    [
      ownerUserId,
      `${ownerUserId.slice(0, 8)}@e.com`,
      teamUserId,
      `${teamUserId.slice(0, 8)}@e.com`,
    ],
  )

  // Seed as a sees-all owner (view_all_events = true).
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
  await client.query("SELECT set_config('app.current_role', 'owner', true)")
  await client.query("SELECT set_config('app.current_user_id', $1, true)", [ownerUserId])
  await client.query("SELECT set_config('app.current_view_all_events', 'true', true)")

  const contactId = createId()
  await client.query(
    `INSERT INTO contacts (id, organization_id, first_name, last_name) VALUES ($1, $2, 'Lead', 'Person')`,
    [contactId, orgId],
  )

  const taskContactAssignedId = createId()
  const taskContactUnassignedId = createId()
  await client.query(
    `INSERT INTO tasks (id, organization_id, contact_id, title, assignee_user_id)
     VALUES ($1, $2, $3, 'Contact task (assigned to team)', $4)`,
    [taskContactAssignedId, orgId, contactId, teamUserId],
  )
  await client.query(
    `INSERT INTO tasks (id, organization_id, contact_id, title)
     VALUES ($1, $2, $3, 'Contact task (unassigned)')`,
    [taskContactUnassignedId, orgId, contactId],
  )

  return {
    orgId,
    ownerUserId,
    teamUserId,
    contactId,
    taskContactAssignedId,
    taskContactUnassignedId,
  }
}

async function switchToTeamMember(client: PoolClient, userId: string, viewAll: boolean) {
  await client.query("SELECT set_config('app.current_role', 'user', true)")
  await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
  await client.query("SELECT set_config('app.current_view_all_events', $1, true)", [
    viewAll ? "true" : "false",
  ])
}

describe("contact tasks — CHECK constraint (project_id OR contact_id)", () => {
  it("inserts a contact-only task (project_id NULL)", async () => {
    await withRawClient(async (client) => {
      const s = await seed(client)
      const r = await client.query(
        `INSERT INTO tasks (id, organization_id, contact_id, title)
         VALUES ($1, $2, $3, 'ok contact-only') RETURNING id`,
        [createId(), s.orgId, s.contactId],
      )
      expect(r.rows.length).toBe(1)
    })
  })

  it("inserts a project-only task (contact_id NULL) — backward compatible", async () => {
    await withRawClient(async (client) => {
      const s = await seed(client)
      const projectId = createId()
      await client.query(
        `INSERT INTO projects (id, organization_id, name, project_type) VALUES ($1, $2, 'P', 'Wedding')`,
        [projectId, s.orgId],
      )
      const r = await client.query(
        `INSERT INTO tasks (id, organization_id, project_id, title)
         VALUES ($1, $2, $3, 'ok project-only') RETURNING id`,
        [createId(), s.orgId, projectId],
      )
      expect(r.rows.length).toBe(1)
    })
  })

  it("REJECTS a task with neither project_id nor contact_id", async () => {
    await withRawClient(async (client) => {
      const s = await seed(client)
      await expect(
        client.query(`INSERT INTO tasks (id, organization_id, title) VALUES ($1, $2, 'orphan')`, [
          createId(),
          s.orgId,
        ]),
      ).rejects.toThrow(/check|constraint/i)
    })
  })
})

describe("contact tasks — RLS under the view_all_events flag", () => {
  it("team member (view_all=false) SEES a contact-only task assigned to them (carve-out)", async () => {
    await withRawClient(async (client) => {
      const s = await seed(client)
      await switchToTeamMember(client, s.teamUserId, false)
      const r = await client.query(`SELECT id FROM tasks WHERE id = $1`, [s.taskContactAssignedId])
      expect(r.rows.length).toBe(1)
    })
  })

  it("team member (view_all=false) does NOT see a contact-only task not assigned to them", async () => {
    await withRawClient(async (client) => {
      const s = await seed(client)
      await switchToTeamMember(client, s.teamUserId, false)
      const r = await client.query(`SELECT id FROM tasks WHERE id = $1`, [
        s.taskContactUnassignedId,
      ])
      expect(r.rows.length).toBe(0)
    })
  })

  it("team member (view_all=true) sees ALL the contact's tasks", async () => {
    await withRawClient(async (client) => {
      const s = await seed(client)
      await switchToTeamMember(client, s.teamUserId, true)
      const r = await client.query(`SELECT id FROM tasks WHERE contact_id = $1`, [s.contactId])
      const ids = r.rows.map((row: { id: string }) => row.id)
      expect(ids).toContain(s.taskContactAssignedId)
      expect(ids).toContain(s.taskContactUnassignedId)
    })
  })
})
