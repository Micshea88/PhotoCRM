/**
 * Push 3 (C6b CORRECTED) — integration tests for the regenerate
 * pipeline. Exercises computeContactFacts against the real DB plus
 * the empty-floor short-circuit. AI calls don't go to Anthropic — in
 * the integration suite there's no API key, so the pipeline naturally
 * falls back to the deterministic engine. That's the path V1 ships on.
 *
 * Direct call into the inner functions (NOT the orgAction wrapper —
 * that requires a full session and lives in E2E territory). The
 * pipeline writes through ctx.db; integration uses withTestDb's
 * transactional handle directly.
 */
import { describe, it, expect } from "vitest"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { contactNotes } from "@/modules/contacts/schema"
import { meetings } from "@/modules/meetings/schema"
import { aiUsageLog } from "@/modules/contacts/ai/ai-usage-schema"
import {
  computeContactFacts,
  isEmptyContact,
  fallbackClassifyFromRules,
} from "@/modules/contacts/ai/lead-status-rules"
import {
  buildEmptyContactSummary,
  buildFallbackSummary,
} from "@/modules/contacts/ai/summary-generator"

describe("computeContactFacts — DB queries the right activity tables", () => {
  it("zero activity → isEmptyContact returns true + counts zero", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "Empty",
        lastName: "Contact",
        contactType: "Lead",
        createdBy: userId,
        updatedBy: userId,
      })

      const facts = await computeContactFacts(db, orgId, cid)
      expect(facts).not.toBeNull()
      expect(facts?.activityCount).toBe(0)
      expect(facts?.notesCount).toBe(0)
      expect(facts?.callsCount).toBe(0)
      expect(facts?.meetingsCount).toBe(0)
      expect(facts?.smsCount).toBe(0)
      expect(isEmptyContact(facts!)).toBe(true)
    })
  })

  it("activity rows across notes + meetings → counts populate, isEmptyContact false", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "Active",
        lastName: "Contact",
        contactType: "Lead",
        createdBy: userId,
        updatedBy: userId,
      })

      await db.insert(contactNotes).values({
        id: createId(),
        organizationId: orgId,
        contactId: cid,
        body: "First touch",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(meetings).values({
        id: createId(),
        organizationId: orgId,
        contactId: cid,
        subject: "Initial consult",
        startsAt: new Date(Date.now() + 86_400_000), // tomorrow
        createdBy: userId,
        updatedBy: userId,
      })

      const facts = await computeContactFacts(db, orgId, cid)
      expect(facts?.notesCount).toBe(1)
      expect(facts?.meetingsCount).toBe(1)
      expect(facts?.activityCount).toBe(2)
      expect(facts?.hasUpcomingMeeting).toBe(true)
      expect(isEmptyContact(facts!)).toBe(false)
    })
  })

  it("polish #5 Fix 9 — referralsMade is OUTBOUND only; inbound leadSource does NOT increment it", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      // Jimmy is a vendor-referral LEAD. Nobody points to him as
      // their referrer. referralsMade MUST be 0 — the "Has made N
      // referral(s)" template the user saw was Haiku confused by
      // robotic phrasing, not a wrong count.
      const jimmy = createId()
      await db.insert(contacts).values({
        id: jimmy,
        organizationId: orgId,
        firstName: "Jimmy",
        lastName: "Jones",
        contactType: "Lead",
        leadSource: "Vendor referral",
        createdBy: userId,
        updatedBy: userId,
      })

      const facts = await computeContactFacts(db, orgId, jimmy)
      expect(facts?.referralsMade).toBe(0)
    })
  })

  it("counts referrals where another contact's referred_by_contact_id points here", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const referrer = createId()
      await db.insert(contacts).values({
        id: referrer,
        organizationId: orgId,
        firstName: "Referrer",
        lastName: "Source",
        contactType: "Referral Partner",
        createdBy: userId,
        updatedBy: userId,
      })
      // 3 referred contacts, each pointing at `referrer`.
      for (let i = 0; i < 3; i++) {
        await db.insert(contacts).values({
          id: createId(),
          organizationId: orgId,
          firstName: `Referred${String(i)}`,
          lastName: "Person",
          referredByContactId: referrer,
          createdBy: userId,
          updatedBy: userId,
        })
      }

      const facts = await computeContactFacts(db, orgId, referrer)
      expect(facts?.referralsMade).toBe(3)
    })
  })
})

describe("Deterministic floor — empty contact summary + status", () => {
  it("empty Lead → 'New Lead' status + 'No activity logged yet.' summary", () => {
    const r = buildEmptyContactSummary({
      firstName: "Empty",
      lastName: "Contact",
      primaryEmail: null,
      primaryPhone: null,
      contactType: "Lead",
      lifecycleStatus: null,
      leadSource: null,
      tags: [],
      notes: null,
    })
    expect(r.status).toBe("New Lead")
    expect(r.summary).toContain("No activity logged yet")
  })
})

describe("Pipeline persistence — write ai_* cache + usage log row", () => {
  it("writes ai_lead_status, ai_summary_text, ai_generated_at, ai_generation_model", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "Empty",
        lastName: "Floor",
        contactType: "Lead",
        createdBy: userId,
        updatedBy: userId,
      })

      // Simulate the floor path manually (the orgAction wrapper
      // needs cookies — out of scope here). The DB writes are the
      // contract under test.
      const facts = await computeContactFacts(db, orgId, cid)
      expect(facts).not.toBeNull()
      expect(isEmptyContact(facts!)).toBe(true)
      const slice = {
        firstName: "Empty",
        lastName: "Floor",
        primaryEmail: null,
        primaryPhone: null,
        contactType: "Lead" as string | null,
        lifecycleStatus: null,
        leadSource: null,
        tags: [],
        notes: null,
      }
      const floorOut = buildEmptyContactSummary(slice)
      const now = new Date()
      await db
        .update(contacts)
        .set({
          aiLeadStatus: floorOut.status,
          aiLeadStatusReasoning: "New contact — no activity yet.",
          aiSummaryText: floorOut.summary,
          aiInsightsJson: { insights: [], version: 1 },
          aiGeneratedAt: now,
          aiGenerationModel: "deterministic-floor@1",
          updatedBy: userId,
        })
        .where(eq(contacts.id, cid))

      // Verify persisted shape.
      const [row] = await db.select().from(contacts).where(eq(contacts.id, cid))
      expect(row?.aiLeadStatus).toBe("New Lead")
      expect(row?.aiSummaryText).toContain("No activity logged yet")
      expect(row?.aiGenerationModel).toBe("deterministic-floor@1")
      expect(row?.aiGeneratedAt).toBeInstanceOf(Date)
    })
  })

  it("usage log table exists + accepts inserts under org context (telemetry shape)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "U",
        lastName: "L",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(aiUsageLog).values({
        id: createId(),
        organizationId: orgId,
        feature: "contacts.classifier",
        model: "rules-engine@1",
        contactId: cid,
        tokensUsed: null,
        ok: "false",
        errorMessage: "no api key",
        triggeredByUserId: userId,
      })
      const rows = await db.select().from(aiUsageLog).where(eq(aiUsageLog.organizationId, orgId))
      expect(rows.length).toBe(1)
      expect(rows[0]?.feature).toBe("contacts.classifier")
      expect(rows[0]?.ok).toBe("false")
    })
  })
})

describe("Fallback classifier — wired in via deterministic path", () => {
  it("Lead with upcoming meeting + Haiku unavailable → Lead in Progress (via fallbackClassifyFromRules)", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "L",
        lastName: "M",
        contactType: "Lead",
        createdBy: userId,
        updatedBy: userId,
      })
      await db.insert(meetings).values({
        id: createId(),
        organizationId: orgId,
        contactId: cid,
        subject: "Consult",
        startsAt: new Date(Date.now() + 86_400_000),
        createdBy: userId,
        updatedBy: userId,
      })
      const facts = await computeContactFacts(db, orgId, cid)
      expect(facts).not.toBeNull()
      expect(facts?.hasUpcomingMeeting).toBe(true)
      // Direct call — the regenerate orgAction path is E2E territory.
      const r = fallbackClassifyFromRules(facts!)
      expect(r.status).toBe("Lead in Progress")
      // Summary fallback exercises the renamed template.
      const t = buildFallbackSummary(
        facts!,
        {
          firstName: "L",
          lastName: "M",
          primaryEmail: null,
          primaryPhone: null,
          contactType: "Lead",
          lifecycleStatus: null,
          leadSource: null,
          tags: [],
          notes: null,
        },
        r.status,
      )
      // Polish #5 Fix 9 — fallback uses first name only per the
      // natural-prose style guide. "L. ..." is the lead-in.
      expect(t).toMatch(/^L\./)
      expect(t).toContain("lead in progress")
    })
  })
})
