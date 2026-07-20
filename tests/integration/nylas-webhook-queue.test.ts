/**
 * Nylas inbound webhook → durable queue routing (A3 step 2).
 *
 * The edge no longer processes inline. It verifies the signature, resolves the
 * org via a cheap grant_id-hash lookup, and enqueues an ORG-SCOPED
 * `nylas_webhook` job keyed on the Nylas event id (idempotent) — the heavy
 * fetch + processInboundEmail run later in the async handler. These tests cover
 * the NEW routing logic: org resolution and idempotent enqueue. (The async
 * processing itself is `ingestNylasWebhook`, covered by its own tests.)
 *
 * Real committed data on a superuser pool — `findConnectionByGrantIdAnyOrg`
 * runs cross-org on the base connection (bypass in prod), which is what the
 * grant resolution needs; withTestDb's rolled-back tx wouldn't be visible to it.
 */
import { describe, it, expect } from "vitest"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { encrypt } from "@/lib/crypto"
import { env } from "@/lib/env"
import * as schema from "@/db/schema"
import { emailConnections } from "@/modules/email-connections/schema"
import { grantIdHash } from "@/modules/email-connections/queries"
import { resolveNylasWebhookRouting } from "@/modules/email-connections/nylas-inbound"
import { backgroundJobs } from "@/modules/jobs/queue/schema"
import { enqueueJob } from "@/modules/jobs/queue/queries"

function bypassUrl(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required for integration tests")
  const u = new URL(raw)
  u.username = "postgres"
  u.password = "postgres"
  return u.toString()
}

function nylasBody(grantId: string, eventId: string): string {
  return JSON.stringify({
    id: eventId,
    type: "message.created",
    data: { object: { grant_id: grantId, id: "msg-1" } },
  })
}

describe("Nylas webhook → queue routing", () => {
  it("resolves org via grant_id and enqueues an idempotent org-scoped job", async () => {
    const pool = new Pool({ connectionString: bypassUrl(), max: 4 })
    const db = drizzle(pool, { schema })
    const userId = createId()
    const orgId = createId()
    const grantId = `grant-${createId()}`

    try {
      await db
        .insert(schema.user)
        .values({
          id: userId,
          name: "T",
          email: `${userId.slice(0, 8)}@ex.com`,
          emailVerified: true,
        })
      await db
        .insert(schema.organization)
        .values({ id: orgId, name: "O", slug: `o-${orgId.slice(0, 8)}`, createdAt: new Date() })
      await db
        .insert(schema.member)
        .values({
          id: createId(),
          organizationId: orgId,
          userId,
          role: "owner",
          createdAt: new Date(),
        })
      await db.insert(emailConnections).values({
        id: createId(),
        organizationId: orgId,
        userId,
        implementation: "nylas",
        provider: "google",
        sourceValue: "gmail",
        email: "studio@example.com",
        grantId: encrypt(grantId, env.NYLAS_ENCRYPTION_KEY),
        grantIdHash: grantIdHash(grantId),
        scopes: "email",
        status: "connected",
      })

      // Resolve → correct org + the Nylas event id as the idempotency key.
      const routed = await resolveNylasWebhookRouting(nylasBody(grantId, "evt-1"), db)
      expect(routed).toEqual({ organizationId: orgId, idempotencyKey: "evt-1" })

      // Enqueue the job (org-scoped, raw payload retained).
      const first = await enqueueJob(db, {
        organizationId: routed!.organizationId,
        type: "nylas_webhook",
        payload: { rawBody: nylasBody(grantId, "evt-1"), signature: "sig" },
        idempotencyKey: routed!.idempotencyKey,
      })
      expect(first.enqueued).toBe(true)

      // Redelivery of the SAME event → dedup, no second job.
      const second = await enqueueJob(db, {
        organizationId: routed!.organizationId,
        type: "nylas_webhook",
        payload: { rawBody: nylasBody(grantId, "evt-1"), signature: "sig" },
        idempotencyKey: routed!.idempotencyKey,
      })
      expect(second.enqueued).toBe(false)
      expect(second.id).toBe(first.id)

      const jobs = await db
        .select()
        .from(backgroundJobs)
        .where(
          and(eq(backgroundJobs.organizationId, orgId), eq(backgroundJobs.type, "nylas_webhook")),
        )
      expect(jobs).toHaveLength(1)
      expect(jobs[0]?.organizationId).toBe(orgId) // payload stays RLS-isolated to the org
    } finally {
      for (const stmt of [
        () => db.delete(backgroundJobs).where(eq(backgroundJobs.organizationId, orgId)),
        () => db.delete(emailConnections).where(eq(emailConnections.organizationId, orgId)),
        () => db.delete(schema.member).where(eq(schema.member.organizationId, orgId)),
        () => db.delete(schema.organization).where(eq(schema.organization.id, orgId)),
        () => db.delete(schema.user).where(eq(schema.user.id, userId)),
      ]) {
        try {
          await stmt()
        } catch {
          /* best-effort */
        }
      }
      await pool.end()
    }
  })

  it("drops (returns null) for an unknown grant, missing grant_id, or unparseable body", async () => {
    const pool = new Pool({ connectionString: bypassUrl(), max: 2 })
    const db = drizzle(pool, { schema })
    try {
      expect(
        await resolveNylasWebhookRouting(nylasBody(`unknown-${createId()}`, "e"), db),
      ).toBeNull()
      expect(
        await resolveNylasWebhookRouting(JSON.stringify({ id: "e", data: { object: {} } }), db),
      ).toBeNull()
      expect(await resolveNylasWebhookRouting("not json", db)).toBeNull()
    } finally {
      await pool.end()
    }
  })
})
