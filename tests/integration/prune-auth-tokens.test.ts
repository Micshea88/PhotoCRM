/**
 * The auth-token prune (H14, prune half). Asserts the OBSERVABLE result: an
 * EXPIRED verification row is deleted while a still-valid one survives — so
 * expired reset tokens don't linger in the DB and the table can't grow unbounded.
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb } from "../helpers/db"
import { verification } from "@/modules/auth/schema"
import { pruneExpiredVerifications } from "@/modules/auth/token-prune"

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0]

async function seedVerification(db: TestDb, id: string, expiresAt: Date) {
  await db.insert(verification).values({
    id,
    identifier: `reset-password:${createId()}`,
    value: createId(),
    expiresAt,
  })
}

describe("pruneExpiredVerifications", () => {
  it("deletes expired verification rows and keeps valid ones", async () => {
    await withTestDb(async (db) => {
      const expiredId = createId()
      const validId = createId()
      await seedVerification(db, expiredId, new Date(Date.now() - 60_000)) // 1 min ago
      await seedVerification(db, validId, new Date(Date.now() + 3_600_000)) // 1h out

      const deleted = await pruneExpiredVerifications(db)

      expect(deleted).toBe(1)
      const [expired] = await db.select().from(verification).where(eq(verification.id, expiredId))
      expect(expired).toBeUndefined() // gone
      const [valid] = await db.select().from(verification).where(eq(verification.id, validId))
      expect(valid?.id).toBe(validId) // survives
    })
  })
})
