/**
 * Push 2c.6.11 commit C — pin the one-email-one-org constraint
 * at invitation-creation time.
 *
 * Architecture: V1 enforces one email = at most one org. The
 * `assertOneEmailOneOrg` guard at the top of
 * `createInviteWithExtendedRoleCore` (src/modules/rbac/actions.ts)
 * runs before the BA invite call and rejects with ActionError
 * CONFLICT in two cases:
 *
 *   1. Email already has a `user` row + a `member` row in a
 *      DIFFERENT org → block
 *   2. Email has a pending non-expired `invitation` row in a
 *      DIFFERENT org → block
 *
 * Same-org pending invitations are NOT blocked — Push 2c.6.10's
 * Cancel/Resend/Reset UX handles those.
 *
 * These tests target the same SELECT logic via the local helper
 * pattern used in prior 2c.6.x tests (the action body can't be
 * called from the harness without faking BA's authAction context).
 */

import { describe, it, expect } from "vitest"
import { and, eq, ne, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createUser } from "../helpers/factories"
import { invitation, member, organization, user } from "@/modules/auth/schema"

async function makeOrg(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  ownerId: string,
): Promise<string> {
  const id = createId()
  await db.insert(organization).values({
    id,
    name: `Org ${id.slice(0, 6)}`,
    slug: `org-${id.slice(0, 6)}`,
    createdAt: new Date(),
  })
  await db.insert(member).values({
    id: createId(),
    organizationId: id,
    userId: ownerId,
    role: "owner",
    createdAt: new Date(),
  })
  return id
}

async function makeInvitation(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  orgId: string,
  inviterId: string,
  email: string,
  opts: { status?: "pending" | "canceled" | "accepted"; expired?: boolean } = {},
): Promise<string> {
  const id = createId()
  await db.insert(invitation).values({
    id,
    organizationId: orgId,
    email,
    role: "member",
    status: opts.status ?? "pending",
    expiresAt: opts.expired
      ? new Date(Date.now() - 60_000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    inviterId,
  })
  return id
}

/**
 * Mirror of assertOneEmailOneOrg. Returns the rejection reason
 * (or null on pass) so tests can assert specific failure modes.
 */
async function checkOneEmailOneOrg(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  inviteEmail: string,
  currentOrgId: string,
): Promise<"cross_org_member" | "cross_org_invite" | null> {
  const emailLower = inviteEmail.toLowerCase().trim()
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`LOWER(${user.email}) = ${emailLower}`)
    .limit(1)
  if (existingUser) {
    const [otherOrgMembership] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, existingUser.id), ne(member.organizationId, currentOrgId)))
      .limit(1)
    if (otherOrgMembership) return "cross_org_member"
  }
  const [otherOrgInvite] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        sql`LOWER(${invitation.email}) = ${emailLower}`,
        eq(invitation.status, "pending"),
        sql`${invitation.expiresAt} > NOW()`,
        ne(invitation.organizationId, currentOrgId),
      ),
    )
    .limit(1)
  if (otherOrgInvite) return "cross_org_invite"
  return null
}

describe("one-email-one-org constraint (Push 2c.6.11 commit C)", () => {
  it("PASSES when the invitee email has no user row and no invitations anywhere", async () => {
    await withTestDb(async (db) => {
      const inviter = await createUser(db)
      const orgId = await makeOrg(db, inviter)
      await setOrgContext(db, orgId, "owner", inviter)
      const result = await checkOneEmailOneOrg(db, "fresh-invitee@example.com", orgId)
      expect(result).toBeNull()
    })
  })

  it("REJECTS cross-org member — invitee is a member of a different org", async () => {
    await withTestDb(async (db) => {
      const inviter = await createUser(db)
      const orgA = await makeOrg(db, inviter)
      await setOrgContext(db, orgA, "owner", inviter)

      // Invitee is already a member of OrgB
      const invitee = await createUser(db, { email: "kelly@example.com" })
      const orgB = await makeOrg(db, await createUser(db))
      await db.insert(member).values({
        id: createId(),
        organizationId: orgB,
        userId: invitee,
        role: "member",
        createdAt: new Date(),
      })

      const result = await checkOneEmailOneOrg(db, "kelly@example.com", orgA)
      expect(result).toBe("cross_org_member")
    })
  })

  it("REJECTS cross-org invite — pending invitation to a different org exists", async () => {
    await withTestDb(async (db) => {
      const inviter = await createUser(db)
      const orgA = await makeOrg(db, inviter)
      await setOrgContext(db, orgA, "owner", inviter)

      const orgB = await makeOrg(db, await createUser(db))
      // Pending invite for the same email already exists in orgB
      await makeInvitation(db, orgB, inviter, "kelly@example.com")

      const result = await checkOneEmailOneOrg(db, "kelly@example.com", orgA)
      expect(result).toBe("cross_org_invite")
    })
  })

  it("PASSES when the cross-org pending invitation has EXPIRED", async () => {
    await withTestDb(async (db) => {
      const inviter = await createUser(db)
      const orgA = await makeOrg(db, inviter)
      await setOrgContext(db, orgA, "owner", inviter)

      const orgB = await makeOrg(db, await createUser(db))
      await makeInvitation(db, orgB, inviter, "kelly@example.com", { expired: true })

      const result = await checkOneEmailOneOrg(db, "kelly@example.com", orgA)
      expect(result).toBeNull()
    })
  })

  it("PASSES when the cross-org invitation is CANCELED", async () => {
    await withTestDb(async (db) => {
      const inviter = await createUser(db)
      const orgA = await makeOrg(db, inviter)
      await setOrgContext(db, orgA, "owner", inviter)

      const orgB = await makeOrg(db, await createUser(db))
      await makeInvitation(db, orgB, inviter, "kelly@example.com", { status: "canceled" })

      const result = await checkOneEmailOneOrg(db, "kelly@example.com", orgA)
      expect(result).toBeNull()
    })
  })

  it("PASSES when a pending invitation exists in the SAME org (same-org case)", async () => {
    await withTestDb(async (db) => {
      const inviter = await createUser(db)
      const orgA = await makeOrg(db, inviter)
      await setOrgContext(db, orgA, "owner", inviter)

      // Pending invite in the SAME org Mike is operating from
      await makeInvitation(db, orgA, inviter, "kelly@example.com")

      const result = await checkOneEmailOneOrg(db, "kelly@example.com", orgA)
      // Push 2c.6.10's Cancel/Resend/Reset UX handles same-org
      // duplicates; the constraint does NOT block this case.
      expect(result).toBeNull()
    })
  })

  it("PASSES when the invitee is already a member of the SAME org", async () => {
    await withTestDb(async (db) => {
      const inviter = await createUser(db)
      const orgA = await makeOrg(db, inviter)
      await setOrgContext(db, orgA, "owner", inviter)

      const invitee = await createUser(db, { email: "kelly@example.com" })
      // Invitee is already in orgA. (The InviteMemberForm UI
      // wouldn't normally let this happen — they're already in the
      // members list — but BA's invite API would handle the
      // duplicate, and the constraint shouldn't block.)
      await db.insert(member).values({
        id: createId(),
        organizationId: orgA,
        userId: invitee,
        role: "member",
        createdAt: new Date(),
      })

      const result = await checkOneEmailOneOrg(db, "kelly@example.com", orgA)
      expect(result).toBeNull()
    })
  })

  it("case-insensitive: KELLY@EXAMPLE.COM matches kelly@example.com", async () => {
    await withTestDb(async (db) => {
      const inviter = await createUser(db)
      const orgA = await makeOrg(db, inviter)
      await setOrgContext(db, orgA, "owner", inviter)

      const orgB = await makeOrg(db, await createUser(db))
      await makeInvitation(db, orgB, inviter, "kelly@example.com")

      // Inviter types the invitee's email in mixed case
      const result = await checkOneEmailOneOrg(db, "KELLY@Example.com", orgA)
      expect(result).toBe("cross_org_invite")
    })
  })

  it("the Reset flow scenario: cancel old + delete orphan + new invite passes through", async () => {
    await withTestDb(async (db) => {
      // Reset cancels the old (same-org) invite + deletes orphan
      // + calls createInviteWithExtendedRoleCore for a fresh one.
      // At the point the constraint runs, the old invite is
      // already canceled and the orphan is deleted. The constraint
      // should see a clean state and allow the new invite.
      const inviter = await createUser(db)
      const orgA = await makeOrg(db, inviter)
      await setOrgContext(db, orgA, "owner", inviter)

      // Simulate post-cancel state: old invite is canceled
      await makeInvitation(db, orgA, inviter, "kelly@example.com", { status: "canceled" })

      const result = await checkOneEmailOneOrg(db, "kelly@example.com", orgA)
      expect(result).toBeNull()
    })
  })

  it("rejection order: cross_org_member wins over cross_org_invite", async () => {
    await withTestDb(async (db) => {
      // Defensive — if BOTH conditions hit, the member check is
      // the stronger signal (the user has actually joined another
      // org, not just been invited). Test pins the order so a
      // future refactor doesn't flip it.
      const inviter = await createUser(db)
      const orgA = await makeOrg(db, inviter)
      await setOrgContext(db, orgA, "owner", inviter)

      const invitee = await createUser(db, { email: "kelly@example.com" })
      const orgB = await makeOrg(db, await createUser(db))
      await db.insert(member).values({
        id: createId(),
        organizationId: orgB,
        userId: invitee,
        role: "member",
        createdAt: new Date(),
      })
      // And ALSO a pending invite in orgC
      const orgC = await makeOrg(db, await createUser(db))
      await makeInvitation(db, orgC, inviter, "kelly@example.com")

      const result = await checkOneEmailOneOrg(db, "kelly@example.com", orgA)
      expect(result).toBe("cross_org_member")
    })
  })
})
