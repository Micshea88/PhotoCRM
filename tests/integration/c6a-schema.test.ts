/**
 * Push 3 (C6a) — schema migrations smoke test.
 *
 * Verifies:
 *   - contacts.ai_* columns exist with the expected types (migration 0035)
 *   - meetings table exists + RLS enabled + the FOR ALL policy is in place (0036)
 *   - sms_messages table exists + RLS enabled + the FOR ALL policy is in place (0037)
 *   - basic insert/select roundtrip on the new tables under app.current_org
 */
import { describe, it, expect } from "vitest"
import { sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { withTestDb, setOrgContext } from "../helpers/db"
import { createOrganization, createUser } from "../helpers/factories"
import { contacts } from "@/modules/contacts/schema"
import { meetings } from "@/modules/meetings/schema"
import { smsMessages } from "@/modules/sms-messages/schema"

describe("C6a — ai cache columns on contacts (migration 0035)", () => {
  it("the ai_* columns exist with the expected types", async () => {
    await withTestDb(async (db) => {
      const result = await db.execute<{ column_name: string; data_type: string }>(sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'contacts'
          AND column_name LIKE 'ai_%'
        ORDER BY column_name
      `)
      const rows = result.rows.map((r) => ({ name: r.column_name, type: r.data_type }))
      expect(rows).toEqual([
        { name: "ai_generated_at", type: "timestamp with time zone" },
        { name: "ai_generation_model", type: "text" },
        { name: "ai_insights_json", type: "jsonb" },
        // Added by the AI-summary-freshness change (throttle stamp).
        { name: "ai_last_regen_attempt_at", type: "timestamp with time zone" },
        { name: "ai_lead_status", type: "text" },
        { name: "ai_lead_status_reasoning", type: "text" },
        { name: "ai_summary_text", type: "text" },
      ])
    })
  })

  it("AI columns are writable + readable under org context", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const cid = createId()
      await db.insert(contacts).values({
        id: cid,
        organizationId: orgId,
        firstName: "AI",
        lastName: "Tester",
        aiLeadStatus: "Hot Lead",
        aiLeadStatusReasoning: "Repeat opens + recent click.",
        aiSummaryText: "Engaged prospect.",
        aiInsightsJson: { insights: [{ kind: "cold_reengage", text: "Reach out soon" }] },
        aiGeneratedAt: new Date(),
        aiGenerationModel: "claude-haiku-4-5-20251001",
        createdBy: userId,
        updatedBy: userId,
      })

      const [row] = await db
        .select()
        .from(contacts)
        .where(sql`${contacts.id} = ${cid}`)
      expect(row?.aiLeadStatus).toBe("Hot Lead")
      expect(row?.aiSummaryText).toBe("Engaged prospect.")
      expect(row?.aiGenerationModel).toBe("claude-haiku-4-5-20251001")
    })
  })
})

describe("C6a — meetings table (migration 0036)", () => {
  it("table exists + RLS is enabled + FOR ALL policy is in place", async () => {
    await withTestDb(async (db) => {
      const tableExists = await db.execute<{ exists: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'meetings'
        ) AS exists
      `)
      expect(tableExists.rows[0]?.exists).toBe(true)

      const rls = await db.execute<{ relrowsecurity: boolean }>(sql`
        SELECT c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'meetings'
      `)
      expect(rls.rows[0]?.relrowsecurity).toBe(true)

      const policies = await db.execute<{ policyname: string; cmd: string }>(sql`
        SELECT policyname, cmd FROM pg_policies
        WHERE tablename = 'meetings'
      `)
      expect(policies.rows.length).toBeGreaterThan(0)
      expect(policies.rows[0]?.policyname).toBe("meetings_org_isolation")
    })
  })

  it("insert + select roundtrip works under org context", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contactId = createId()
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "Meeting",
        lastName: "Contact",
        createdBy: userId,
        updatedBy: userId,
      })

      const meetingId = createId()
      await db.insert(meetings).values({
        id: meetingId,
        organizationId: orgId,
        contactId,
        subject: "Initial consult",
        notes: "Discussed budget.",
        startsAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
      })

      const [row] = await db
        .select()
        .from(meetings)
        .where(sql`${meetings.id} = ${meetingId}`)
      expect(row?.subject).toBe("Initial consult")
    })
  })
})

describe("C6a — sms_messages table (migration 0037)", () => {
  it("table exists + RLS is enabled + FOR ALL policy is in place", async () => {
    await withTestDb(async (db) => {
      const tableExists = await db.execute<{ exists: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'sms_messages'
        ) AS exists
      `)
      expect(tableExists.rows[0]?.exists).toBe(true)

      const rls = await db.execute<{ relrowsecurity: boolean }>(sql`
        SELECT c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'sms_messages'
      `)
      expect(rls.rows[0]?.relrowsecurity).toBe(true)

      const policies = await db.execute<{ policyname: string }>(sql`
        SELECT policyname FROM pg_policies
        WHERE tablename = 'sms_messages'
      `)
      expect(policies.rows[0]?.policyname).toBe("sms_messages_org_isolation")
    })
  })

  it("insert + select roundtrip works under org context", async () => {
    await withTestDb(async (db) => {
      const userId = await createUser(db)
      const orgId = await createOrganization(db, userId)
      await setOrgContext(db, orgId, "owner", userId)

      const contactId = createId()
      await db.insert(contacts).values({
        id: contactId,
        organizationId: orgId,
        firstName: "SMS",
        lastName: "Contact",
        createdBy: userId,
        updatedBy: userId,
      })

      const smsId = createId()
      await db.insert(smsMessages).values({
        id: smsId,
        organizationId: orgId,
        contactId,
        direction: "outbound",
        body: "Hi! Are you available tomorrow?",
        sentAt: new Date(),
        sentByUserId: userId,
      })

      const [row] = await db
        .select()
        .from(smsMessages)
        .where(sql`${smsMessages.id} = ${smsId}`)
      expect(row?.body).toBe("Hi! Are you available tomorrow?")
      expect(row?.direction).toBe("outbound")
    })
  })
})
