/**
 * RLS integration tests for `notifications` and `notification_preferences`.
 *
 * Key nuance: `notifications` has TWO different scopings:
 *   - SELECT/UPDATE/DELETE → org + recipient_user_id (each user sees/modifies only their own rows)
 *   - INSERT → org only (so Task 10's dispatcher can create notifications for OTHER users)
 *
 * `notification_preferences` → all ops scoped to org + user_id (user manages only their own prefs).
 *
 * No mock/Drizzle — raw pg client, app layer intentionally bypassed. ROLLBACK at end.
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { PoolClient } from "pg"
import { withRawClient } from "../helpers/rls"

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedOrg(client: PoolClient, label: string) {
  const id = createId()
  await client.query(
    `INSERT INTO organization (id, name, slug, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [id, label, `${label.toLowerCase().replace(/\s+/g, "-")}-${id.slice(0, 8)}`],
  )
  return id
}

async function seedUser(client: PoolClient, label: string) {
  const id = createId()
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), NOW())`,
    [id, label, `${id.slice(0, 8)}@example.com`],
  )
  return id
}

async function setCtx(client: PoolClient, orgId: string, userId: string) {
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgId])
  await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
}

/** Insert a minimal notification row (used by all test cases). */
async function insertNotification(
  client: PoolClient,
  orgId: string,
  recipientUserId: string,
  contactId: string | null = null,
) {
  const id = createId()
  await client.query(
    `INSERT INTO notifications (
       id, organization_id, recipient_user_id,
       type, category, tier, title, source_module,
       contact_id, created_at, updated_at
     ) VALUES ($1, $2, $3, 'email.open', 'lead', 'routine', 'Test', 'email', $4, NOW(), NOW())`,
    [id, orgId, recipientUserId, contactId],
  )
  return id
}

// ---------------------------------------------------------------------------
// notifications — SELECT / UPDATE / DELETE scoped to recipient + org
// ---------------------------------------------------------------------------

describe("notifications — RLS", () => {
  it("user A1 reads only their own notifications, not A2's in the same org", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const userA1 = await seedUser(client, "A1")
      const userA2 = await seedUser(client, "A2")

      // Dispatcher context: org=A, current user=A1
      await setCtx(client, orgA, userA1)
      // Own notification
      await insertNotification(client, orgA, userA1)
      // Dispatcher inserts for A2 (INSERT only checks org — should succeed)
      await insertNotification(client, orgA, userA2)

      // Read as A1 — sees only the A1 row
      const r1 = await client.query(`SELECT id FROM notifications`)
      expect(r1.rows.length).toBe(1)

      // Switch to A2 — sees only the A2 row
      await setCtx(client, orgA, userA2)
      const r2 = await client.query(`SELECT id FROM notifications`)
      expect(r2.rows.length).toBe(1)
    })
  })

  it("user A1 sees zero notifications from org B", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const orgB = await seedOrg(client, "OrgB")
      const userA1 = await seedUser(client, "A1")
      const userB1 = await seedUser(client, "B1")

      // Seed org B's notification
      await setCtx(client, orgB, userB1)
      await insertNotification(client, orgB, userB1)

      // Read as A1 in org A — should see nothing
      await setCtx(client, orgA, userA1)
      const r = await client.query(`SELECT id FROM notifications`)
      expect(r.rows.length).toBe(0)
    })
  })

  it("dispatcher INSERT with recipient=A2 succeeds when org context is A (org-only WITH CHECK)", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const userA1 = await seedUser(client, "A1")
      const userA2 = await seedUser(client, "A2")

      // Dispatcher: org=A, current user=A1, but inserting FOR A2
      await setCtx(client, orgA, userA1)

      // Must NOT throw — INSERT only checks org, not recipient_user_id
      await expect(insertNotification(client, orgA, userA2)).resolves.not.toThrow()
    })
  })

  it("cross-org INSERT is rejected", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const orgB = await seedOrg(client, "OrgB")
      const userA1 = await seedUser(client, "A1")

      await setCtx(client, orgA, userA1)

      // Try to insert a notification into org B while context is org A
      await expect(insertNotification(client, orgB, userA1)).rejects.toThrow(
        /row-level security|policy/i,
      )
    })
  })

  it("NULL-contact system notice inserts fine; contact-filtered read returns only the linked row", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const userA1 = await seedUser(client, "A1")

      // Insert contact first (contacts has org-isolation RLS; set org context)
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgA])
      const contactId = createId()
      await client.query(
        `INSERT INTO contacts (id, organization_id, first_name, last_name)
         VALUES ($1, $2, 'Ada', 'Lovelace')`,
        [contactId, orgA],
      )

      await setCtx(client, orgA, userA1)

      // Notification linked to a contact
      await insertNotification(client, orgA, userA1, contactId)
      // System notice — contact_id IS NULL
      await insertNotification(client, orgA, userA1, null)

      // Total for A1 = 2
      const all = await client.query(`SELECT id FROM notifications`)
      expect(all.rows.length).toBe(2)

      // Contact-filtered read: 1 row
      const linked = await client.query(`SELECT id FROM notifications WHERE contact_id = $1`, [
        contactId,
      ])
      expect(linked.rows.length).toBe(1)

      // NULL-contact filter: 1 row
      const nullContact = await client.query(
        `SELECT id FROM notifications WHERE contact_id IS NULL`,
      )
      expect(nullContact.rows.length).toBe(1)
    })
  })

  it("UPDATE on own notification succeeds; UPDATE on another user's notification affects 0 rows", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const userA1 = await seedUser(client, "A1")
      const userA2 = await seedUser(client, "A2")

      await setCtx(client, orgA, userA1)
      // Dispatcher inserts for both (INSERT is org-scoped)
      const id1 = await insertNotification(client, orgA, userA1)
      const id2 = await insertNotification(client, orgA, userA2)

      // A1 marks own notification as read → succeeds (1 row affected)
      const upd1 = await client.query(`UPDATE notifications SET read_at = NOW() WHERE id = $1`, [
        id1,
      ])
      expect(upd1.rowCount).toBe(1)

      // A1 tries to mark A2's notification as read → silently blocked by RLS (0 rows)
      const upd2 = await client.query(`UPDATE notifications SET read_at = NOW() WHERE id = $1`, [
        id2,
      ])
      expect(upd2.rowCount).toBe(0)
    })
  })

  it("no-context read returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const userA1 = await seedUser(client, "A1")
      await setCtx(client, orgA, userA1)
      await insertNotification(client, orgA, userA1)

      // Clear both contexts
      await client.query("SELECT set_config('app.current_org', '', true)")
      await client.query("SELECT set_config('app.current_user_id', '', true)")

      const r = await client.query(`SELECT id FROM notifications`)
      expect(r.rows.length).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// notification_preferences — all ops scoped to org + user_id
// ---------------------------------------------------------------------------

describe("notification_preferences — RLS", () => {
  it("user A1 reads only their own preferences; A2 sees zero (separate reads, same org)", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const userA1 = await seedUser(client, "A1")
      const userA2 = await seedUser(client, "A2")

      // A1 inserts their own pref
      await setCtx(client, orgA, userA1)
      await client.query(
        `INSERT INTO notification_preferences
           (id, organization_id, user_id, type, in_app, email, created_at, updated_at)
         VALUES ($1, $2, $3, 'email.open', true, true, NOW(), NOW())`,
        [createId(), orgA, userA1],
      )

      // A1 reads — sees only their own pref
      const r1 = await client.query(`SELECT id FROM notification_preferences`)
      expect(r1.rows.length).toBe(1)

      // Switch to A2 — sees nothing (they have no prefs yet)
      await setCtx(client, orgA, userA2)
      const r2 = await client.query(`SELECT id FROM notification_preferences`)
      expect(r2.rows.length).toBe(0)
    })
  })

  it("A1 cannot insert a preference for A2 (WITH CHECK rejects cross-user insert)", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const userA1 = await seedUser(client, "A1")
      const userA2 = await seedUser(client, "A2")

      await setCtx(client, orgA, userA1)

      // user_id = A2 but current_user_id = A1 → WITH CHECK fails
      await expect(
        client.query(
          `INSERT INTO notification_preferences
             (id, organization_id, user_id, type, in_app, email, created_at, updated_at)
           VALUES ($1, $2, $3, 'email.open', true, false, NOW(), NOW())`,
          [createId(), orgA, userA2],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("A1 can update and delete their own preference", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const userA1 = await seedUser(client, "A1")

      await setCtx(client, orgA, userA1)
      const prefId = createId()
      await client.query(
        `INSERT INTO notification_preferences
           (id, organization_id, user_id, type, in_app, email, created_at, updated_at)
         VALUES ($1, $2, $3, 'email.open', true, true, NOW(), NOW())`,
        [prefId, orgA, userA1],
      )

      const upd = await client.query(
        `UPDATE notification_preferences SET email = false WHERE id = $1`,
        [prefId],
      )
      expect(upd.rowCount).toBe(1)

      const del = await client.query(`DELETE FROM notification_preferences WHERE id = $1`, [prefId])
      expect(del.rowCount).toBe(1)
    })
  })

  it("cross-org INSERT into notification_preferences is rejected", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const orgB = await seedOrg(client, "OrgB")
      const userA1 = await seedUser(client, "A1")

      await setCtx(client, orgA, userA1)

      await expect(
        client.query(
          `INSERT INTO notification_preferences
             (id, organization_id, user_id, type, in_app, email, created_at, updated_at)
           VALUES ($1, $2, $3, 'email.open', true, true, NOW(), NOW())`,
          [createId(), orgB, userA1],
        ),
      ).rejects.toThrow(/row-level security|policy/i)
    })
  })

  it("no-context read returns 0 rows", async () => {
    await withRawClient(async (client) => {
      const orgA = await seedOrg(client, "OrgA")
      const userA1 = await seedUser(client, "A1")
      await setCtx(client, orgA, userA1)
      await client.query(
        `INSERT INTO notification_preferences
           (id, organization_id, user_id, type, in_app, email, created_at, updated_at)
         VALUES ($1, $2, $3, 'email.open', true, true, NOW(), NOW())`,
        [createId(), orgA, userA1],
      )

      await client.query("SELECT set_config('app.current_org', '', true)")
      await client.query("SELECT set_config('app.current_user_id', '', true)")

      const r = await client.query(`SELECT id FROM notification_preferences`)
      expect(r.rows.length).toBe(0)
    })
  })
})
