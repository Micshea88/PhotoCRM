/**
 * Integration tests for Task 19 — listExpiredConnectionsForUser query.
 *
 * Covers:
 *   1. Returns only the expired (status="expired") connections for the user.
 *   2. Does not return connected (status="connected") connections.
 *   3. Does not return soft-deleted expired connections.
 *   4. Does not return expired connections belonging to a DIFFERENT user.
 *
 * Uses withTestDb so every test runs inside a rolled-back transaction.
 * setOrgContext sets app.current_org required by the email_connections RLS
 * policy (organization_id = current_setting('app.current_org', true)).
 */
import { describe, it, expect } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { emailConnections } from "@/modules/email-connections/schema"
import { encrypt } from "@/lib/crypto"
import { env } from "@/lib/env"
import { grantIdHash } from "@/modules/email-connections/queries"
import { listExpiredConnectionsForUser } from "@/modules/email-connections/queries"

// ─── Seed helpers ─────────────────────────────────────────────────────────────

type Db = Parameters<typeof setOrgContext>[0]

async function seedConnection(
  db: Db,
  orgId: string,
  userId: string,
  opts: {
    status: "connected" | "expired"
    email?: string
    /** Provider key — defaults to "google". Use a different value per-test when
     *  seeding multiple LIVE (deletedAt=null) rows for the same user to avoid
     *  the partial unique index on (org, user, provider) WHERE deletedAt IS NULL. */
    provider?: string
    deletedAt?: Date | null
  },
): Promise<string> {
  const id = createId()
  const plainGrantId = `grant_${createId()}`
  const grantCipher = encrypt(plainGrantId, env.NYLAS_ENCRYPTION_KEY)
  const hash = grantIdHash(plainGrantId)
  const email = opts.email ?? `${id.slice(0, 8)}@example.com`
  const provider = opts.provider ?? "google"
  const sourceValue = provider === "microsoft" ? "outlook" : "gmail"

  await db.insert(emailConnections).values({
    id,
    organizationId: orgId,
    userId,
    implementation: "nylas",
    provider,
    sourceValue,
    email,
    grantId: grantCipher,
    grantIdHash: hash,
    scopes: "email",
    status: opts.status,
    deletedAt: opts.deletedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("listExpiredConnectionsForUser (Task 19)", () => {
  it("returns expired connections for the user and not connected ones", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Use distinct providers so the partial unique index (org, user, provider)
      // WHERE deletedAt IS NULL allows both live rows to coexist.
      const expiredId = await seedConnection(db, orgId, userId, {
        status: "expired",
        provider: "google",
      })
      await seedConnection(db, orgId, userId, {
        status: "connected",
        provider: "microsoft",
        email: "connected@example.com",
      })

      const rows = await listExpiredConnectionsForUser(db, orgId, userId)

      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(expiredId)
      expect(rows[0]!.status).toBe("expired")
    })
  })

  it("does not return soft-deleted expired connections", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // A soft-deleted expired connection — should NOT appear
      await seedConnection(db, orgId, userId, {
        status: "expired",
        deletedAt: new Date(),
      })

      const rows = await listExpiredConnectionsForUser(db, orgId, userId)
      expect(rows).toHaveLength(0)
    })
  })

  it("does not return expired connections belonging to a different user", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // A second org member with their own expired connection
      const otherUserId = await createUser(db)
      await seedConnection(db, orgId, otherUserId, {
        status: "expired",
        email: "other@example.com",
      })

      // The querying user has no expired connections
      const rows = await listExpiredConnectionsForUser(db, orgId, userId)
      expect(rows).toHaveLength(0)
    })
  })

  it("returns all expired connections when a user has multiple", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Seed two expired connections (different providers to satisfy the unique
      // index on (org, user, provider) for live rows — here both are expired
      // so deletedAt IS NULL but provider differs to avoid the partial unique
      // constraint which only fires when deletedAt IS NULL).
      await db.insert(emailConnections).values([
        {
          id: createId(),
          organizationId: orgId,
          userId,
          implementation: "nylas",
          provider: "google",
          sourceValue: "gmail",
          email: "first@example.com",
          grantId: encrypt(`g1_${createId()}`, env.NYLAS_ENCRYPTION_KEY),
          grantIdHash: grantIdHash(`g1_${createId()}`),
          scopes: "email",
          status: "expired",
          createdAt: new Date(Date.now() - 2000),
          updatedAt: new Date(),
        },
        {
          id: createId(),
          organizationId: orgId,
          userId,
          implementation: "nylas",
          provider: "microsoft",
          sourceValue: "outlook",
          email: "second@example.com",
          grantId: encrypt(`g2_${createId()}`, env.NYLAS_ENCRYPTION_KEY),
          grantIdHash: grantIdHash(`g2_${createId()}`),
          scopes: "email",
          status: "expired",
          createdAt: new Date(Date.now() - 1000),
          updatedAt: new Date(),
        },
      ])

      const rows = await listExpiredConnectionsForUser(db, orgId, userId)
      expect(rows).toHaveLength(2)
      // Ordered by createdAt DESC (most recent first)
      expect(rows[0]!.email).toBe("second@example.com")
      expect(rows[1]!.email).toBe("first@example.com")
    })
  })

  it("returns empty array when user has no connections at all", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const rows = await listExpiredConnectionsForUser(db, orgId, userId)
      expect(rows).toHaveLength(0)
    })
  })
})
