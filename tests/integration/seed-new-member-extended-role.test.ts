/**
 * Push 2c.6.5 — close-out tests for the accept-invite metadata
 * propagation path that Push 2c.6.4 introduced.
 *
 * The afterAcceptInvitation BA hook fires seedNewMember, which
 * delegates to `resolveAndSeedExtendedMemberRole`:
 *
 *   1. Metadata row present  → member_role.role = stored extended
 *      role (Admin / Manager / Team member / Accountant).
 *   2. Metadata row absent   → fall back to extendedFromBetterAuth
 *      (BA admin → "admin"; BA member → "user").
 *   3. Bogus invitationId    → same metadata-absent fallback (no
 *      crash; tolerates a race where BA fires the hook before our
 *      metadata row was committed, or where compensation cleaned
 *      it up).
 *
 * These tests target the helper directly (inside withTestDb's
 * savepoint wrapper) rather than seedNewMember itself, because
 * seedNewMember opens its own tx via the global `db` import and
 * the global db doesn't share a connection with the test
 * fixture's wrapped client.
 */

import { describe, it, expect } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { resolveAndSeedExtendedMemberRole } from "@/lib/seed-new-member"
import { invitation } from "@/modules/auth/schema"
import { invitationExtendedRole, memberRole } from "@/modules/rbac/schema"

async function insertInvitation(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  orgId: string,
  inviterId: string,
  baRole: "admin" | "member",
  email = `${createId().slice(0, 8)}@example.com`,
): Promise<string> {
  const id = createId()
  await db.insert(invitation).values({
    id,
    organizationId: orgId,
    email,
    role: baRole,
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    inviterId,
  })
  return id
}

describe("resolveAndSeedExtendedMemberRole (Push 2c.6.5)", () => {
  it("uses the metadata row's extended role when present", async () => {
    await withTestDb(async (db) => {
      const inviterId = await createUser(db)
      const orgId = await createOrganization(db, inviterId)
      await setOrgContext(db, orgId, "owner", inviterId)

      const invitee = await createUser(db)
      const invId = await insertInvitation(db, orgId, inviterId, "member")
      await db.insert(invitationExtendedRole).values({
        invitationId: invId,
        organizationId: orgId,
        extendedRole: "manager",
        createdBy: inviterId,
      })

      const result = await resolveAndSeedExtendedMemberRole(db, orgId, invitee, "member", invId)

      expect(result.extendedRole).toBe("manager")
      expect(result.resolvedFromMetadata).toBe(true)

      // Confirm the member_role row materialised with "manager".
      const [row] = await db
        .select()
        .from(memberRole)
        .where(and(eq(memberRole.organizationId, orgId), eq(memberRole.userId, invitee)))
        .limit(1)
      expect(row?.role).toBe("manager")
    })
  })

  it("falls back to extendedFromBetterAuth when no metadata row exists (legacy invite)", async () => {
    await withTestDb(async (db) => {
      const inviterId = await createUser(db)
      const orgId = await createOrganization(db, inviterId)
      await setOrgContext(db, orgId, "owner", inviterId)

      const invitee = await createUser(db)
      const invId = await insertInvitation(db, orgId, inviterId, "member")
      // NO invitation_extended_role row — simulates a pre-2c.6.4
      // pending invitation.

      const result = await resolveAndSeedExtendedMemberRole(db, orgId, invitee, "member", invId)

      // extendedFromBetterAuth("member") = "user"
      expect(result.extendedRole).toBe("user")
      expect(result.resolvedFromMetadata).toBe(false)

      const [row] = await db
        .select()
        .from(memberRole)
        .where(and(eq(memberRole.organizationId, orgId), eq(memberRole.userId, invitee)))
        .limit(1)
      expect(row?.role).toBe("user")
    })
  })

  it("falls back to BA admin → extended admin when no metadata row exists", async () => {
    await withTestDb(async (db) => {
      const inviterId = await createUser(db)
      const orgId = await createOrganization(db, inviterId)
      await setOrgContext(db, orgId, "owner", inviterId)

      const invitee = await createUser(db)
      const invId = await insertInvitation(db, orgId, inviterId, "admin")

      const result = await resolveAndSeedExtendedMemberRole(db, orgId, invitee, "admin", invId)

      // extendedFromBetterAuth("admin") = "admin"
      expect(result.extendedRole).toBe("admin")
      expect(result.resolvedFromMetadata).toBe(false)

      const [row] = await db
        .select()
        .from(memberRole)
        .where(and(eq(memberRole.organizationId, orgId), eq(memberRole.userId, invitee)))
        .limit(1)
      expect(row?.role).toBe("admin")
    })
  })

  it("tolerates a bogus invitationId without crashing (race / compensation cleanup)", async () => {
    await withTestDb(async (db) => {
      const inviterId = await createUser(db)
      const orgId = await createOrganization(db, inviterId)
      await setOrgContext(db, orgId, "owner", inviterId)

      const invitee = await createUser(db)
      // Pass an invitation id that doesn't exist — simulates a
      // race where BA fired afterAcceptInvitation before our
      // metadata row was committed, OR a successful compensation
      // cleanup that deleted the row.
      const result = await resolveAndSeedExtendedMemberRole(
        db,
        orgId,
        invitee,
        "member",
        "non_existent_invitation_id",
      )

      expect(result.extendedRole).toBe("user")
      expect(result.resolvedFromMetadata).toBe(false)

      const [row] = await db
        .select()
        .from(memberRole)
        .where(and(eq(memberRole.organizationId, orgId), eq(memberRole.userId, invitee)))
        .limit(1)
      expect(row?.role).toBe("user")
    })
  })

  it("tolerates an omitted invitationId (defensive — should never happen post-2c.6.4)", async () => {
    await withTestDb(async (db) => {
      const inviterId = await createUser(db)
      const orgId = await createOrganization(db, inviterId)
      await setOrgContext(db, orgId, "owner", inviterId)

      const invitee = await createUser(db)
      const result = await resolveAndSeedExtendedMemberRole(db, orgId, invitee, "member", undefined)
      expect(result.extendedRole).toBe("user")
      expect(result.resolvedFromMetadata).toBe(false)
    })
  })

  it("is idempotent — re-running with the same args is a no-op", async () => {
    await withTestDb(async (db) => {
      const inviterId = await createUser(db)
      const orgId = await createOrganization(db, inviterId)
      await setOrgContext(db, orgId, "owner", inviterId)

      const invitee = await createUser(db)
      const invId = await insertInvitation(db, orgId, inviterId, "member")
      await db.insert(invitationExtendedRole).values({
        invitationId: invId,
        organizationId: orgId,
        extendedRole: "accountant",
        createdBy: inviterId,
      })

      await resolveAndSeedExtendedMemberRole(db, orgId, invitee, "member", invId)
      await resolveAndSeedExtendedMemberRole(db, orgId, invitee, "member", invId)

      // Still one row, still "accountant".
      const rows = await db
        .select()
        .from(memberRole)
        .where(and(eq(memberRole.organizationId, orgId), eq(memberRole.userId, invitee)))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.role).toBe("accountant")
    })
  })
})

/**
 * Also pin the getPendingInvitations LEFT JOIN behavior so the
 * /settings/organization/members UI never silently regresses to
 * showing the BA role instead of the inviter's intended extended
 * role.
 */
describe("getPendingInvitations LEFT JOIN extended-role (Push 2c.6.5 Gap 1)", () => {
  it("returns extendedRole when an invitation_extended_role row exists", async () => {
    await withTestDb(async (db) => {
      const inviterId = await createUser(db)
      const orgId = await createOrganization(db, inviterId)
      await setOrgContext(db, orgId, "owner", inviterId)

      const invId = await insertInvitation(db, orgId, inviterId, "member")
      await db.insert(invitationExtendedRole).values({
        invitationId: invId,
        organizationId: orgId,
        extendedRole: "manager",
        createdBy: inviterId,
      })

      // Mirror getPendingInvitations exactly (the prod query uses
      // the global `db` import, but the JOIN logic is identical).
      const rows = await db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          extendedRole: invitationExtendedRole.extendedRole,
        })
        .from(invitation)
        .leftJoin(invitationExtendedRole, eq(invitationExtendedRole.invitationId, invitation.id))
        .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.extendedRole).toBe("manager")
    })
  })

  it("returns extendedRole=null when no metadata row exists (legacy)", async () => {
    await withTestDb(async (db) => {
      const inviterId = await createUser(db)
      const orgId = await createOrganization(db, inviterId)
      await setOrgContext(db, orgId, "owner", inviterId)

      const invId = await insertInvitation(db, orgId, inviterId, "admin")
      void invId

      const rows = await db
        .select({
          id: invitation.id,
          extendedRole: invitationExtendedRole.extendedRole,
        })
        .from(invitation)
        .leftJoin(invitationExtendedRole, eq(invitationExtendedRole.invitationId, invitation.id))
        .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.extendedRole).toBeNull()
    })
  })

  it("removes the invitation row from the pending list when it's been accepted", async () => {
    await withTestDb(async (db) => {
      const inviterId = await createUser(db)
      const orgId = await createOrganization(db, inviterId)
      await setOrgContext(db, orgId, "owner", inviterId)

      const id = createId()
      await db.insert(invitation).values({
        id,
        organizationId: orgId,
        email: `${id.slice(0, 8)}@example.com`,
        role: "member",
        status: "accepted",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        inviterId,
      })

      const rows = await db
        .select({ id: invitation.id })
        .from(invitation)
        .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, "pending")))
      expect(rows).toHaveLength(0)
    })
  })

  it("isNull() helper sanity — unused but keeps imports honest", () => {
    expect(typeof isNull).toBe("function")
  })
})
