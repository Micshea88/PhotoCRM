/**
 * Piece B — team-member account recovery. The recovery actions
 * (sendMemberPasswordReset / revokeMemberSessions / resendMemberVerification)
 * wrap `auth.api` calls the harness can't synthesize a session for, so — per the
 * repo's established pattern (invite-hygiene.test.ts) — we test the load-bearing
 * pieces against real Postgres:
 *
 *   1. `requireOrgMember` — the ISOLATION BOUNDARY every recovery action goes
 *      through. It must refuse a member of another org, so an owner can never
 *      recover a user in a different studio.
 *   2. The session-revoke effect — deleting a member's `session` rows signs only
 *      THAT member out, not anyone else.
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb } from "../helpers/db"
import { createUser, createOrganization } from "../helpers/factories"
import { member, session } from "@/modules/auth/schema"
import { requireOrgMember } from "@/modules/org/actions"

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0]

async function addMember(db: TestDb, orgId: string, userId: string): Promise<string> {
  const id = createId()
  await db
    .insert(member)
    .values({ id, organizationId: orgId, userId, role: "member", createdAt: new Date() })
  return id
}

async function seedSession(db: TestDb, userId: string): Promise<void> {
  await db.insert(session).values({
    id: createId(),
    userId,
    token: createId(),
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

describe("member recovery — isolation boundary + session revoke", () => {
  it("requireOrgMember resolves an in-org member to its user", async () => {
    await withTestDb(async (db) => {
      const ownerId = await createUser(db)
      const orgId = await createOrganization(db, ownerId)
      const memberUserId = await createUser(db, { email: "teammate@example.com" })
      const memberId = await addMember(db, orgId, memberUserId)

      const target = await requireOrgMember(db, orgId, memberId)
      expect(target.userId).toBe(memberUserId)
      expect(target.email).toBe("teammate@example.com")
    })
  })

  it("REFUSES a member of another org — the cross-studio isolation guard", async () => {
    await withTestDb(async (db) => {
      const ownerA = await createUser(db)
      const orgA = await createOrganization(db, ownerA)
      const ownerB = await createUser(db)
      const orgB = await createOrganization(db, ownerB)
      // orgB's owner member row.
      const [bMember] = await db
        .select({ id: member.id })
        .from(member)
        .where(eq(member.organizationId, orgB))
        .limit(1)

      // Acting as orgA, try to touch orgB's member → FORBIDDEN.
      await expect(requireOrgMember(db, orgA, bMember!.id)).rejects.toThrow(
        /different organization/i,
      )
    })
  })

  it("throws NOT_FOUND for an unknown member id", async () => {
    await withTestDb(async (db) => {
      const ownerId = await createUser(db)
      const orgId = await createOrganization(db, ownerId)
      await expect(requireOrgMember(db, orgId, "does-not-exist")).rejects.toThrow(/not found/i)
    })
  })

  it("revoking a member's sessions deletes only that member's rows", async () => {
    await withTestDb(async (db) => {
      const ownerId = await createUser(db)
      const orgId = await createOrganization(db, ownerId)
      const memberUserId = await createUser(db)
      const memberId = await addMember(db, orgId, memberUserId)
      await seedSession(db, memberUserId)
      await seedSession(db, memberUserId)
      await seedSession(db, ownerId)

      // The action body: resolve the in-org target, then delete its sessions.
      const target = await requireOrgMember(db, orgId, memberId)
      await db.delete(session).where(eq(session.userId, target.userId))

      const remaining = await db.select({ userId: session.userId }).from(session)
      expect(remaining.some((s) => s.userId === memberUserId)).toBe(false) // signed out
      expect(remaining.some((s) => s.userId === ownerId)).toBe(true) // untouched
    })
  })
})
