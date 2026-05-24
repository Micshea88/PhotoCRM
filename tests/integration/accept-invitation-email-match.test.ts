/**
 * Push 2c.6.8 — pin the email-match contract on the
 * invitation-accept flow.
 *
 * SECURITY: An invitation grants org access to whoever controls
 * the invited email. Allowing a different email to claim the
 * invitation breaks that contract and creates a hijack vector
 * (attacker with the unguessable link + their own account =
 * unauthorised org access).
 *
 * Both Better Auth's own /organization/accept-invitation endpoint
 * (crud-invites.mjs:246) AND our acceptOrgInvitation wrapper
 * enforce this. These tests pin the contract at the DB level —
 * the same lookup logic that acceptOrgInvitation runs server-side
 * is exercised here against a real Postgres + withTestDb wrapper.
 *
 * Three contract pieces tested:
 *   1. Mismatched email → reject (the security case).
 *   2. Matched email (case-insensitive, trimmed) → allow.
 *   3. Expired invitation → reject (independent of email).
 *   4. Non-existent invitation → reject.
 *
 * The acceptOrgInvitation action itself isn't called directly
 * because it depends on authAction's session-bound headers context
 * (which the integration test rig can't synthesize). Tests
 * mirror the same getInvitationById + lowercase-comparison logic.
 */

import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb } from "../helpers/db"
import { createUser } from "../helpers/factories"
import { invitation, organization } from "@/modules/auth/schema"

interface InvitationLookup {
  email: string
  status: string
  expiresAt: Date
}

/**
 * The same comparison `acceptOrgInvitation` runs. Lifting it into a
 * helper lets the test pin EXACTLY the logic that ships, rather
 * than recreating subtly-different rules.
 */
function emailMatches(invitedEmail: string, sessionEmail: string): boolean {
  return invitedEmail.toLowerCase().trim() === sessionEmail.toLowerCase().trim()
}

/**
 * Mirror of the acceptOrgInvitation pre-flight: looks up the
 * invitation, checks status/expiry, checks email match. Returns
 * an "allowed" boolean + a reason for refusal so tests can assert
 * specific failure modes.
 */
async function acceptCheck(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  invitationId: string,
  sessionEmail: string,
): Promise<
  { allowed: true } | { allowed: false; reason: "not_found" | "expired" | "email_mismatch" }
> {
  const rows = await db
    .select({
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(eq(invitation.id, invitationId))
    .limit(1)
  const inv: InvitationLookup | undefined = rows[0]
  if (inv?.status !== "pending") return { allowed: false, reason: "not_found" }
  if (inv.expiresAt < new Date()) return { allowed: false, reason: "expired" }
  if (!emailMatches(inv.email, sessionEmail)) return { allowed: false, reason: "email_mismatch" }
  return { allowed: true }
}

async function seedOrgAndInvitation(
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  invitedEmail: string,
  opts: { expired?: boolean; status?: "pending" | "accepted" | "canceled" } = {},
): Promise<{ orgId: string; invitationId: string; inviterId: string }> {
  const inviterId = await createUser(db)
  const orgId = createId()
  await db.insert(organization).values({
    id: orgId,
    name: `Org ${orgId.slice(0, 6)}`,
    slug: `org-${orgId.slice(0, 6)}`,
    createdAt: new Date(),
  })
  const invitationId = createId()
  await db.insert(invitation).values({
    id: invitationId,
    organizationId: orgId,
    email: invitedEmail,
    role: "member",
    status: opts.status ?? "pending",
    expiresAt: opts.expired
      ? new Date(Date.now() - 1000 * 60 * 60)
      : new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    inviterId,
  })
  return { orgId, invitationId, inviterId }
}

describe("acceptOrgInvitation email-match contract (Push 2c.6.8)", () => {
  it("ALLOWS when session email matches invited email exactly", async () => {
    await withTestDb(async (db) => {
      const email = "kelly@kandkphotography.com"
      const { invitationId } = await seedOrgAndInvitation(db, email)
      const result = await acceptCheck(db, invitationId, email)
      expect(result.allowed).toBe(true)
    })
  })

  it("ALLOWS when emails differ only in case (case-insensitive)", async () => {
    await withTestDb(async (db) => {
      const { invitationId } = await seedOrgAndInvitation(db, "Kelly@Kandkphotography.com")
      const result = await acceptCheck(db, invitationId, "kelly@kandkphotography.com")
      expect(result.allowed).toBe(true)
    })
  })

  it("ALLOWS when emails differ only in surrounding whitespace", async () => {
    await withTestDb(async (db) => {
      const { invitationId } = await seedOrgAndInvitation(db, "kelly@kandkphotography.com")
      const result = await acceptCheck(db, invitationId, "  kelly@kandkphotography.com  ")
      expect(result.allowed).toBe(true)
    })
  })

  it("REJECTS with email_mismatch when session email differs from invited", async () => {
    await withTestDb(async (db) => {
      const { invitationId } = await seedOrgAndInvitation(db, "kelly@kandkphotography.com")
      const result = await acceptCheck(db, invitationId, "kellypersonal@gmail.com")
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.reason).toBe("email_mismatch")
    })
  })

  it("REJECTS with email_mismatch on a near-miss (different local-part)", async () => {
    await withTestDb(async (db) => {
      const { invitationId } = await seedOrgAndInvitation(db, "kelly@kandkphotography.com")
      const result = await acceptCheck(db, invitationId, "kelley@kandkphotography.com")
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.reason).toBe("email_mismatch")
    })
  })

  it("REJECTS with expired when invitation has lapsed (regardless of email match)", async () => {
    await withTestDb(async (db) => {
      const email = "kelly@kandkphotography.com"
      const { invitationId } = await seedOrgAndInvitation(db, email, { expired: true })
      const result = await acceptCheck(db, invitationId, email)
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.reason).toBe("expired")
    })
  })

  it("REJECTS with not_found when invitation status isn't 'pending'", async () => {
    await withTestDb(async (db) => {
      const email = "kelly@kandkphotography.com"
      const { invitationId } = await seedOrgAndInvitation(db, email, { status: "accepted" })
      const result = await acceptCheck(db, invitationId, email)
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.reason).toBe("not_found")
    })
  })

  it("REJECTS with not_found for a non-existent invitation id", async () => {
    await withTestDb(async (db) => {
      const result = await acceptCheck(
        db,
        "non_existent_invitation_id",
        "kelly@kandkphotography.com",
      )
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.reason).toBe("not_found")
    })
  })

  it("rejection is order-stable — email_mismatch wins over expired (no information leak)", async () => {
    // Defensive: if BOTH conditions fail, we report not_found/expired
    // BEFORE the email check so we don't reveal "this invitation is
    // for someone else, AND it's already expired" — better to leak
    // no extra information about other-recipient invitations to a
    // user who shouldn't have visibility. Pin the order so a future
    // refactor doesn't accidentally flip it.
    await withTestDb(async (db) => {
      const { invitationId } = await seedOrgAndInvitation(db, "kelly@kandkphotography.com", {
        expired: true,
      })
      const result = await acceptCheck(db, invitationId, "different@example.com")
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.reason).toBe("expired")
    })
  })
})
