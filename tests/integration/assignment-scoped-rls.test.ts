/**
 * Assignment-scoped RLS overlay — the security boundary change owned by
 * commit 14a per contacts/projects/tasks/rbac READMEs, with role
 * names refreshed to the 6-role taxonomy by migration 0021.
 *
 * For the ASSIGNMENT-SCOPED tier (role `user` — the standard
 * team-member tier; the merged photographer/contractor/editor of the
 * old 8-role taxonomy):
 *   - SELECT on contacts: only contacts associated with a project the
 *     team member is project-assigned to (via project_photographers)
 *   - SELECT on projects: only projects the team member is assigned to
 *   - SELECT on tasks:    only tasks on projects the team member is
 *     project-assigned to OR tasks where the team member is the
 *     direct assignee
 *   - INSERT/UPDATE/DELETE on contacts and projects: BLOCKED
 *   - UPDATE on tasks: allowed only when assignee_user_id = current
 *     team member (the markTaskDone carve-out for self-owned tasks)
 *   - INSERT/DELETE on tasks: BLOCKED
 *
 * For the FULL-VISIBILITY tier (owner, admin, manager, accountant,
 * and client — though `client` has no permissions in V1): unchanged
 * from V1 — full org-scoped read/write.
 *
 * Cross-org boundary: the policy preserves
 * `organization_id = current_setting('app.current_org', true)` as the
 * OUTER AND-clamp. The assignment-scoped expression is the inner OR.
 * This ordering is the proof that the overlay cannot LOOSEN org
 * isolation (test "cross-org attack" at the bottom).
 *
 * Raw-pg, app layer fully bypassed.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

interface Scenario {
  orgId: string
  adminUserId: string
  photogUserId: string
  // Project P1 — photographer ASSIGNED via project_photographers
  projectAssignedId: string
  // Project P2 — photographer NOT assigned
  projectUnassignedId: string
  // Contact C1 — associated with P1 only (via project_contacts)
  contactOnAssignedId: string
  // Contact C2 — associated with P2 only
  contactOnUnassignedId: string
  // Task T1 — on P1, no specific assignee
  taskOnAssignedId: string
  // Task T2 — on P2, no specific assignee
  taskOnUnassignedId: string
  // Task T3 — on P2 (which photographer is NOT assigned to), but
  // assignee_user_id = photographer (direct assignee carve-out)
  taskDirectAssigneeId: string
}

async function seedAdminContext(client: PoolClient): Promise<Scenario> {
  const orgId = createId()
  const adminUserId = createId()
  const photogUserId = createId()

  // Tables outside RLS: organization, "user", member.
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, 'Org A', $2, NOW())`,
    [orgId, `orga-${orgId.slice(0, 8)}`],
  )
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Admin', $2, true, NOW(), NOW()), ($3, 'Photog', $4, true, NOW(), NOW())`,
    [
      adminUserId,
      `${adminUserId.slice(0, 8)}@example.com`,
      photogUserId,
      `${photogUserId.slice(0, 8)}@example.com`,
    ],
  )
  await client.query(
    `INSERT INTO member (id, organization_id, user_id, role, created_at)
     VALUES ($1, $2, $3, 'owner', NOW()), ($4, $5, $6, 'member', NOW())`,
    [createId(), orgId, adminUserId, createId(), orgId, photogUserId],
  )

  // Operate as owner to seed the rest. Owner = sees-all → view_all_events true
  // (migration 0047 — the overlay now reads this GUC, not the role string).
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
  await client.query("SELECT set_config('app.current_role', 'owner', true)")
  await client.query("SELECT set_config('app.current_user_id', $1, true)", [adminUserId])
  await client.query("SELECT set_config('app.current_view_all_events', 'true', true)")

  const projectAssignedId = createId()
  const projectUnassignedId = createId()
  await client.query(
    `INSERT INTO projects (id, organization_id, name, project_type)
     VALUES ($1, $2, 'P1 (assigned)', 'Wedding'),
            ($3, $2, 'P2 (unassigned)', 'Wedding')`,
    [projectAssignedId, orgId, projectUnassignedId],
  )
  await client.query(
    `INSERT INTO project_photographers (id, organization_id, project_id, user_id, role)
     VALUES ($1, $2, $3, $4, 'lead')`,
    [createId(), orgId, projectAssignedId, photogUserId],
  )

  const contactOnAssignedId = createId()
  const contactOnUnassignedId = createId()
  await client.query(
    `INSERT INTO contacts (id, organization_id, first_name, last_name)
     VALUES ($1, $2, 'Alice', 'Assigned'),
            ($3, $2, 'Ursula', 'Unassigned')`,
    [contactOnAssignedId, orgId, contactOnUnassignedId],
  )
  await client.query(
    `INSERT INTO project_contacts (id, organization_id, project_id, contact_id, role)
     VALUES ($1, $2, $3, $4, 'primary'),
            ($5, $2, $6, $7, 'primary')`,
    [
      createId(),
      orgId,
      projectAssignedId,
      contactOnAssignedId,
      createId(),
      projectUnassignedId,
      contactOnUnassignedId,
    ],
  )

  const taskOnAssignedId = createId()
  const taskOnUnassignedId = createId()
  const taskDirectAssigneeId = createId()
  await client.query(
    `INSERT INTO tasks (id, organization_id, project_id, title)
     VALUES ($1, $2, $3, 'T1 (on assigned project)'),
            ($4, $2, $5, 'T2 (on unassigned project, no direct assignee)')`,
    [taskOnAssignedId, orgId, projectAssignedId, taskOnUnassignedId, projectUnassignedId],
  )
  await client.query(
    `INSERT INTO tasks (id, organization_id, project_id, title, assignee_user_id)
     VALUES ($1, $2, $3, 'T3 (direct-assignee)', $4)`,
    [taskDirectAssigneeId, orgId, projectUnassignedId, photogUserId],
  )

  return {
    orgId,
    adminUserId,
    photogUserId,
    projectAssignedId,
    projectUnassignedId,
    contactOnAssignedId,
    contactOnUnassignedId,
    taskOnAssignedId,
    taskOnUnassignedId,
    taskDirectAssigneeId,
  }
}

async function switchToTeamMember(client: PoolClient, teamMemberUserId: string, viewAll = false) {
  await client.query("SELECT set_config('app.current_role', 'user', true)")
  await client.query("SELECT set_config('app.current_user_id', $1, true)", [teamMemberUserId])
  // Migration 0047: the overlay keys on this flag. Team member defaults to
  // assignment-scoped (false); pass viewAll=true to probe an override grant.
  await client.query("SELECT set_config('app.current_view_all_events', $1, true)", [
    viewAll ? "true" : "false",
  ])
}

describe("assignment-scoped RLS overlay — projects", () => {
  // Per migration 0021, the prior photographer/contractor/editor cases
  // collapse into the single `user` tier. One test asserts the visibility
  // shape; the cross-org probe at the bottom is the security-boundary
  // proof. No coverage regression — the three old roles all evaluated
  // through the same NOT IN list.
  it("team member (role `user`) CAN see project they're project-assigned to", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`SELECT id FROM projects WHERE id = $1`, [s.projectAssignedId])
      expect(r.rows.length).toBe(1)
    })
  })

  it("team member CANNOT see project they're not assigned to", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`SELECT id FROM projects WHERE id = $1`, [s.projectUnassignedId])
      expect(r.rows.length).toBe(0)
    })
  })

  it("team member sees only their assigned projects in a full-org list", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`SELECT id FROM projects WHERE organization_id = $1`, [s.orgId])
      const ids = r.rows.map((row: { id: string }) => row.id)
      expect(ids).toContain(s.projectAssignedId)
      expect(ids).not.toContain(s.projectUnassignedId)
    })
  })
})

describe("assignment-scoped RLS overlay — contacts", () => {
  it("team member CAN see contacts on projects they're assigned to", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`SELECT id FROM contacts WHERE id = $1`, [s.contactOnAssignedId])
      expect(r.rows.length).toBe(1)
    })
  })

  it("team member CANNOT see contacts only on projects they're not assigned to", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`SELECT id FROM contacts WHERE id = $1`, [
        s.contactOnUnassignedId,
      ])
      expect(r.rows.length).toBe(0)
    })
  })
})

describe("assignment-scoped RLS overlay — tasks", () => {
  it("team member CAN see tasks on projects they're project-assigned to", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`SELECT id FROM tasks WHERE id = $1`, [s.taskOnAssignedId])
      expect(r.rows.length).toBe(1)
    })
  })

  it("team member CANNOT see tasks on projects they're not assigned to (no direct assignee)", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`SELECT id FROM tasks WHERE id = $1`, [s.taskOnUnassignedId])
      expect(r.rows.length).toBe(0)
    })
  })

  it("team member CAN see a task where they are the direct assignee even on an unassigned project (carve-out)", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`SELECT id FROM tasks WHERE id = $1`, [s.taskDirectAssigneeId])
      expect(r.rows.length).toBe(1)
    })
  })

  it("team member CAN UPDATE a task assigned directly to them (markTaskDone carve-out)", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`UPDATE tasks SET status = 'done' WHERE id = $1 RETURNING id`, [
        s.taskDirectAssigneeId,
      ])
      expect(r.rows.length).toBe(1)
    })
  })

  it("team member CANNOT UPDATE a task they don't own (returns 0 rows)", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(`UPDATE tasks SET status = 'done' WHERE id = $1 RETURNING id`, [
        s.taskOnUnassignedId,
      ])
      expect(r.rows.length).toBe(0)
    })
  })

  it("team member CANNOT INSERT a new task (gate blocks writes)", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      await expect(
        client.query(
          `INSERT INTO tasks (id, organization_id, project_id, title)
           VALUES ($1, $2, $3, 'X')`,
          [createId(), s.orgId, s.projectAssignedId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })
})

describe("assignment-scoped RLS overlay — full-visibility control roles", () => {
  it("owner sees all projects in the org (unchanged)", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      // Already operating as owner from seedAdminContext.
      const r = await client.query(`SELECT id FROM projects WHERE organization_id = $1`, [s.orgId])
      const ids = r.rows.map((row: { id: string }) => row.id)
      expect(ids).toContain(s.projectAssignedId)
      expect(ids).toContain(s.projectUnassignedId)
    })
  })

  it("admin sees all projects in the org", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await client.query("SELECT set_config('app.current_role', 'admin', true)")
      await client.query("SELECT set_config('app.current_view_all_events', 'true', true)")
      const r = await client.query(`SELECT id FROM projects WHERE organization_id = $1`, [s.orgId])
      expect(r.rows.length).toBe(2)
    })
  })

  it("manager sees all projects in the org", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await client.query("SELECT set_config('app.current_role', 'manager', true)")
      await client.query("SELECT set_config('app.current_view_all_events', 'true', true)")
      const r = await client.query(`SELECT id FROM projects WHERE organization_id = $1`, [s.orgId])
      expect(r.rows.length).toBe(2)
    })
  })

  it("accountant sees all projects in the org", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await client.query("SELECT set_config('app.current_role', 'accountant', true)")
      await client.query("SELECT set_config('app.current_view_all_events', 'true', true)")
      const r = await client.query(`SELECT id FROM projects WHERE organization_id = $1`, [s.orgId])
      expect(r.rows.length).toBe(2)
    })
  })
})

describe("assignment-scoped RLS overlay — cross-org attack (org isolation MUST hold)", () => {
  it("team member in org B with a forged project_photographers assignment to an org A project STILL cannot see org A's data", async () => {
    await withRawClient(async (client) => {
      // Org A — seed via the normal helper.
      const a = await seedAdminContext(client)

      // Org B — a separate org with its own photographer.
      const orgB = createId()
      const photogB = createId()
      await client.query(
        `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, 'Org B', $2, NOW())`,
        [orgB, `orgb-${orgB.slice(0, 8)}`],
      )
      await client.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, 'Photog B', $2, true, NOW(), NOW())`,
        [photogB, `${photogB.slice(0, 8)}@example.com`],
      )
      await client.query(
        `INSERT INTO member (id, organization_id, user_id, role, created_at)
         VALUES ($1, $2, $3, 'member', NOW())`,
        [createId(), orgB, photogB],
      )

      // Forge a project_photographers row in org B claiming assignment to
      // org A's project. The forge passes org B's WITH CHECK on project_
      // photographers because we set app.current_org to orgB while inserting.
      // (project_photographers.project_id is a real org A project — FK passes
      // because the FK doesn't carry org_id check; that's RLS's job.)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      await client.query(
        `INSERT INTO project_photographers (id, organization_id, project_id, user_id, role)
         VALUES ($1, $2, $3, $4, 'lead')`,
        [createId(), orgB, a.projectAssignedId, photogB],
      )

      // Now operate as team member B in org B context (assignment-scoped:
      // relies on the forged project_photographers row, not view-all).
      await client.query("SELECT set_config('app.current_role', 'user', true)")
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [photogB])
      await client.query("SELECT set_config('app.current_view_all_events', 'false', true)")

      // Probe org A's project. The new policy's outer AND-clamp is
      // `organization_id = current_setting('app.current_org', true)` —
      // current_setting is orgB; the org A project's organization_id is
      // orgA; the clamp is FALSE; row hidden regardless of the forged
      // assignment row.
      const r = await client.query(`SELECT id FROM projects WHERE id = $1`, [a.projectAssignedId])
      expect(r.rows.length).toBe(0)
    })
  })

  it("team member in org A with a real assignment but probing org B's data sees zero (no forge needed)", async () => {
    await withRawClient(async (client) => {
      const a = await seedAdminContext(client)

      // A separate org B project that org A's photographer cannot see.
      const orgB = createId()
      await client.query(
        `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, 'Org B', $2, NOW())`,
        [orgB, `orgb-${orgB.slice(0, 8)}`],
      )
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      const orgBProjectId = createId()
      await client.query(
        `INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'B project')`,
        [orgBProjectId, orgB],
      )

      // Switch back to org A context as the team member.
      await client.query("SELECT set_config('app.current_org', $1, true)", [a.orgId])
      await client.query("SELECT set_config('app.current_role', 'user', true)")
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [a.photogUserId])
      await client.query("SELECT set_config('app.current_view_all_events', 'false', true)")
      const r = await client.query(`SELECT id FROM projects WHERE id = $1`, [orgBProjectId])
      expect(r.rows.length).toBe(0)
    })
  })
})

describe("assignment-scoped RLS overlay — write gate on contacts/projects", () => {
  it("team member CANNOT INSERT a contact", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      await expect(
        client.query(
          `INSERT INTO contacts (id, organization_id, first_name, last_name)
           VALUES ($1, $2, 'X', 'Y')`,
          [createId(), s.orgId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("team member CANNOT UPDATE a contact (returns 0 rows, even on an assigned-project's contact)", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(
        `UPDATE contacts SET first_name = 'Mutated' WHERE id = $1 RETURNING id`,
        [s.contactOnAssignedId],
      )
      expect(r.rows.length).toBe(0)
    })
  })

  it("team member CANNOT INSERT a project", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      await expect(
        client.query(
          `INSERT INTO projects (id, organization_id, name)
           VALUES ($1, $2, 'X')`,
          [createId(), s.orgId],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("team member CANNOT UPDATE a project (even one they're assigned to)", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      await switchToTeamMember(client, s.photogUserId)
      const r = await client.query(
        `UPDATE projects SET name = 'Mutated' WHERE id = $1 RETURNING id`,
        [s.projectAssignedId],
      )
      expect(r.rows.length).toBe(0)
    })
  })
})

describe("view_all_events flag — per-user visibility override (migration 0047)", () => {
  it("team member WITH view_all_events=true sees ALL projects/contacts/tasks in-org", async () => {
    await withRawClient(async (client) => {
      const s = await seedAdminContext(client)
      // The contractor→employee grant: same `user` role, flag overridden on.
      await switchToTeamMember(client, s.photogUserId, true)

      const proj = await client.query(`SELECT id FROM projects WHERE organization_id = $1`, [
        s.orgId,
      ])
      const projIds = proj.rows.map((row: { id: string }) => row.id)
      expect(projIds).toContain(s.projectAssignedId)
      expect(projIds).toContain(s.projectUnassignedId)

      const c = await client.query(`SELECT id FROM contacts WHERE id = $1`, [
        s.contactOnUnassignedId,
      ])
      expect(c.rows.length).toBe(1)

      const t = await client.query(`SELECT id FROM tasks WHERE id = $1`, [s.taskOnUnassignedId])
      expect(t.rows.length).toBe(1)
    })
  })

  it("a view_all_events=true session STILL cannot cross orgs (flag respects the org clamp)", async () => {
    await withRawClient(async (client) => {
      const a = await seedAdminContext(client)
      const orgB = createId()
      await client.query(
        `INSERT INTO organization (id, name, slug, created_at) VALUES ($1, 'Org B', $2, NOW())`,
        [orgB, `orgb-${orgB.slice(0, 8)}`],
      )
      // Operate in org B with view-all ON — org A's project must stay hidden.
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgB])
      await client.query("SELECT set_config('app.current_role', 'owner', true)")
      await client.query("SELECT set_config('app.current_view_all_events', 'true', true)")
      const r = await client.query(`SELECT id FROM projects WHERE id = $1`, [a.projectAssignedId])
      expect(r.rows.length).toBe(0)
    })
  })
})
