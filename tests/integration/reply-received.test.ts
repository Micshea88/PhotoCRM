/**
 * Task 12 — email.reply_received notification wiring.
 *
 * Tests `processInboundEmail` notification emission and `buildBodyPreview`.
 *
 * Visibility-limitation note (mirrors grant-expired.test.ts):
 *   `processInboundEmail` uses the module-level `db` (a separate pool from
 *   withTestDb).  We therefore mock `@/lib/db` with a configurable in-memory
 *   implementation and mock `@/modules/notifications/dispatch` to capture
 *   `emitNotification` calls — this exercises the full decision logic without
 *   requiring committed Postgres data.
 *
 * Covers:
 *   1. Reply (inReplyTo set) with opts.recipientUserIds → email.reply_received emitted
 *   2. Reply via inheritedThreadId (References, no inReplyTo) → emitted
 *   3. Cold inbound (no inReplyTo, no thread match) → NOT emitted
 *   4. Dedup: dedup guard fires → 0 returned, no notification
 *   5. Resend lane (no opts) → fallback resolves org owner+admin as recipients
 *   6. Unknown sender → 0, no notification
 *   7. Sender with blank name → title falls back to email address
 *   8. buildBodyPreview pure helper (no DB at all)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { EmitNotificationInput } from "@/modules/notifications/dispatch"
import type { InboundEmail } from "@/modules/email-log/inbound"

// ─── hoisted mock state ────────────────────────────────────────────────────

/**
 * Per-test configurable state for the db mock.  `vi.hoisted` ensures this
 * object is available inside the `vi.mock` factory (which runs before imports).
 */
const dbMockState = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  txInsertId: "default_email_log_id",
  txInsertCount: 0,
}))

const mockEmitNotification = vi.hoisted(() => vi.fn().mockResolvedValue({ created: 1 }))

// ─── module mocks ──────────────────────────────────────────────────────────

vi.mock("@/modules/notifications/dispatch", () => ({
  emitNotification: mockEmitNotification,
  emitNotificationInTx: vi.fn(),
}))

vi.mock("@/lib/env", () => ({
  env: {
    RESEND_API_KEY: "re_test_key",
    RESEND_WEBHOOK_SECRET: undefined,
  },
}))

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/**
 * Mock `@/lib/db` with a minimal Drizzle-compatible implementation.
 *
 * Each `db.select()` call pops the next entry from `dbMockState.selectQueue`.
 * The `db.transaction()` call runs the callback with a minimal tx mock.
 * The tx mock's first `insert(...).values(...)` call returns
 * `dbMockState.txInsertId`; subsequent inserts succeed silently.
 */
vi.mock("@/lib/db", () => {
  function makeChain(result: unknown[]) {
    // Thenable chain that can be used as:
    //   await db.select(...).from(...).where(...).limit(1)    → result
    //   await db.select(...).from(...).where(...)             → result (no limit)
    //   await db.select(...).from(...).where(...).orderBy(...).limit(1) → result
    const chain: {
      from: () => typeof chain
      where: () => typeof chain
      orderBy: () => typeof chain
      limit: (_n: number) => Promise<unknown[]>
      then: (
        onfulfilled?: ((v: unknown[]) => unknown) | null,
        onrejected?: ((r: unknown) => unknown) | null,
      ) => Promise<unknown>
    } = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (_n: number) => Promise.resolve(result),
      then: (onfulfilled, onrejected) => Promise.resolve(result).then(onfulfilled, onrejected),
    }
    return chain
  }

  function makeTx() {
    dbMockState.txInsertCount = 0
    return {
      execute: vi.fn().mockResolvedValue(undefined),
      insert: (_table: unknown) => ({
        values: (_vals: unknown) => {
          const isFirst = dbMockState.txInsertCount === 0
          dbMockState.txInsertCount++
          const onConflictResult = isFirst ? [{ id: dbMockState.txInsertId }] : []
          // Support: .onConflictDoNothing().returning(...)  AND  await .values(...) directly
          return {
            onConflictDoNothing: () => ({
              returning: (_cols: unknown) => Promise.resolve(onConflictResult),
            }),
            then: (
              onfulfilled?: (() => unknown) | null,
              onrejected?: ((r: unknown) => unknown) | null,
            ) => Promise.resolve(undefined).then(onfulfilled, onrejected),
          }
        },
      }),
    }
  }

  const db = {
    select: (_cols?: unknown) => {
      const result = dbMockState.selectQueue.shift() ?? []
      return makeChain(result)
    },
    transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      return fn(makeTx())
    },
  }

  return { db }
})

// ─── imports (AFTER vi.mock declarations) ──────────────────────────────────

import { processInboundEmail, buildBodyPreview } from "@/modules/email-log/inbound"

// ─── test constants & helpers ─────────────────────────────────────────────

const TEST_ORG_ID = "org_reply_rcvd_test"
const TEST_CONTACT_ID = "contact_sender_abc"
const TEST_OWNER_ID = "user_owner_xyz"
const TEST_ADMIN_ID = "user_admin_xyz"

const SENDER_CONTACT = {
  id: TEST_CONTACT_ID,
  organizationId: TEST_ORG_ID,
  firstName: "Alice",
  lastName: "Smith",
}

function makeInbound(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    messageId: `<${createId()}@example.com>`,
    from: "alice@example.com",
    to: ["photographer@studio.com"],
    cc: [],
    subject: "Re: Wedding Gallery",
    body: "Thanks so much! The photos are beautiful.",
    inReplyTo: "<original-msg-id@studio.com>",
    references: "<original-msg-id@studio.com>",
    sentAt: new Date("2026-07-04T10:00:00Z"),
    ...overrides,
  }
}

/**
 * Set up dbMockState for the current test.
 * `selectQueue` is consumed in call order by `db.select()`.
 */
function setupDb(selectQueue: unknown[][], insertId?: string) {
  dbMockState.selectQueue = [...selectQueue]
  dbMockState.txInsertId = insertId ?? createId()
  dbMockState.txInsertCount = 0
}

// ─── tests ────────────────────────────────────────────────────────────────

describe("processInboundEmail — email.reply_received notification (Task 12)", () => {
  beforeEach(() => {
    mockEmitNotification.mockReset()
    mockEmitNotification.mockResolvedValue({ created: 1 })
    dbMockState.selectQueue = []
    dbMockState.txInsertCount = 0
  })

  // ── 1. Reply (inReplyTo set) → notification emitted ─────────────────────

  it("reply with inReplyTo set: emits email.reply_received with correct fields", async () => {
    const emailLogId = createId()
    const inbound = makeInbound()
    setupDb(
      [
        [SENDER_CONTACT], // findContactAnyOrg
        [], // dedup check → no existing
        [{ threadId: "thread_existing_abc" }], // thread lookup (inReplyTo set)
        [], // findContactInOrg for to[0]
      ],
      emailLogId,
    )

    const result = await processInboundEmail(inbound, "gmail", {
      recipientUserIds: [TEST_OWNER_ID],
    })

    expect(result).toBeGreaterThan(0)
    expect(mockEmitNotification).toHaveBeenCalledOnce()

    const call = mockEmitNotification.mock.calls[0]![0] as EmitNotificationInput
    expect(call.type).toBe("email.reply_received")
    expect(call.organizationId).toBe(TEST_ORG_ID)
    expect(call.recipientUserIds).toContain(TEST_OWNER_ID)
    expect(call.actorUserId).toBeNull()
    expect(call.contactId).toBe(TEST_CONTACT_ID)
    expect(call.title).toContain("Alice Smith")
    expect(call.title).toContain("replied")
    expect(call.body).toBeTruthy()
    expect(call.body).toContain("Wedding Gallery")
    expect(call.linkPath).toBe(`/contacts/${TEST_CONTACT_ID}`)
    expect(call.sourceModule).toBe("email")
    expect(call.payload).toMatchObject({
      emailLogId,
      messageId: inbound.messageId,
    })
  })

  // ── 2. Reply via References (no inReplyTo but thread found) ─────────────

  it("reply via References thread match: emits notification even without inReplyTo", async () => {
    const inbound = makeInbound({
      inReplyTo: null,
      references: "<prior-ref@studio.com>",
    })
    setupDb([
      [SENDER_CONTACT], // findContactAnyOrg
      [], // dedup check
      [{ threadId: "thread_via_refs_xyz" }], // thread lookup via References
      [], // findContactInOrg for to[0]
    ])

    const result = await processInboundEmail(inbound, "gmail", {
      recipientUserIds: [TEST_OWNER_ID],
    })

    expect(result).toBeGreaterThan(0)
    expect(mockEmitNotification).toHaveBeenCalledOnce()
    const call = mockEmitNotification.mock.calls[0]![0] as EmitNotificationInput
    expect(call.type).toBe("email.reply_received")
  })

  // ── 3. Cold inbound (no inReplyTo, no thread match) → NO notification ────

  it("cold inbound (no inReplyTo, no thread match): does NOT emit reply_received", async () => {
    const inbound = makeInbound({
      inReplyTo: null,
      references: null,
    })
    // No References → refIds empty → no thread lookup query
    setupDb([
      [SENDER_CONTACT], // findContactAnyOrg
      [], // dedup check
      // No thread-lookup call since refIds is empty
      [], // findContactInOrg for to[0]
    ])

    const result = await processInboundEmail(inbound, "gmail", {
      recipientUserIds: [TEST_OWNER_ID],
    })

    expect(result).toBeGreaterThan(0)
    expect(mockEmitNotification).not.toHaveBeenCalled()
  })

  // ── 4. Dedup: dedup guard → 0, no notification ───────────────────────────

  it("dedup: returns 0 and does NOT emit notification when message already logged", async () => {
    const inbound = makeInbound()
    setupDb([
      [SENDER_CONTACT], // findContactAnyOrg
      [{ id: "already_logged" }], // dedup check → existing row → early return
    ])

    const result = await processInboundEmail(inbound, "gmail", {
      recipientUserIds: [TEST_OWNER_ID],
    })

    expect(result).toBe(0)
    expect(mockEmitNotification).not.toHaveBeenCalled()
  })

  // ── 5. Resend lane (no opts) → fallback owner+admin recipients ───────────

  it("Resend lane (no opts): notification recipients = org owners + admins", async () => {
    const emailLogId = createId()
    const inbound = makeInbound()
    setupDb(
      [
        [SENDER_CONTACT], // findContactAnyOrg
        [], // dedup check
        [{ threadId: "thread_resend_123" }], // thread lookup
        [], // findContactInOrg for to[0]
        // memberRole fallback query (no .limit() suffix — chain is awaited directly)
        [{ userId: TEST_OWNER_ID }, { userId: TEST_ADMIN_ID }],
      ],
      emailLogId,
    )

    // No opts → falls back to memberRole query for org owner+admins
    const result = await processInboundEmail(inbound, "resend")

    expect(result).toBeGreaterThan(0)
    expect(mockEmitNotification).toHaveBeenCalledOnce()
    const call = mockEmitNotification.mock.calls[0]![0] as EmitNotificationInput
    expect(call.recipientUserIds).toContain(TEST_OWNER_ID)
    expect(call.recipientUserIds).toContain(TEST_ADMIN_ID)
  })

  // ── 6. Unknown sender → 0, no notification ───────────────────────────────

  it("unknown sender: returns 0 and does NOT emit notification", async () => {
    const inbound = makeInbound()
    setupDb([
      [], // findContactAnyOrg → no match
    ])

    const result = await processInboundEmail(inbound, "gmail", {
      recipientUserIds: [TEST_OWNER_ID],
    })

    expect(result).toBe(0)
    expect(mockEmitNotification).not.toHaveBeenCalled()
  })

  // ── 7. Blank sender name → title falls back to email address ─────────────

  it("sender with blank firstName+lastName: title uses email address instead", async () => {
    const blankNameContact = { ...SENDER_CONTACT, firstName: "", lastName: "" }
    setupDb([[blankNameContact], [], [{ threadId: "thread_blankname" }], []])

    await processInboundEmail(makeInbound(), "gmail", { recipientUserIds: [TEST_OWNER_ID] })

    const call = mockEmitNotification.mock.calls[0]?.[0] as EmitNotificationInput | undefined
    expect(call).toBeDefined()
    expect(call!.title).toContain("alice@example.com")
    expect(call!.title).toContain("replied")
  })
})

// ─── buildBodyPreview pure helper ─────────────────────────────────────────

describe("buildBodyPreview (pure helper — no DB)", () => {
  it("returns null for null input", () => {
    expect(buildBodyPreview(null)).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(buildBodyPreview("")).toBeNull()
  })

  it("strips HTML tags and collapses whitespace", () => {
    expect(buildBodyPreview("<p>Hello <b>world</b></p>")).toBe("Hello world")
  })

  it("removes quoted reply lines (> prefix)", () => {
    const body = "Thanks!\n> On Monday you wrote:\n> Please review the gallery."
    const result = buildBodyPreview(body)
    expect(result).not.toBeNull()
    expect(result!).toContain("Thanks!")
    expect(result!).not.toContain(">")
  })

  it("caps at maxLen and appends ellipsis", () => {
    const long = "A".repeat(200)
    const result = buildBodyPreview(long, 140)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(140)
    expect(result!.endsWith("…")).toBe(true)
  })

  it("does not truncate when content is shorter than maxLen", () => {
    expect(buildBodyPreview("Short message")).toBe("Short message")
  })

  it("collapses multiple whitespace sequences to a single space", () => {
    expect(buildBodyPreview("Hello   \n\n   World")).toBe("Hello World")
  })

  it("returns null when only quoted content remains after stripping", () => {
    // Only > lines — result is null after filter
    const body = "> quoted line\n> another quoted line"
    const result = buildBodyPreview(body)
    // After stripping > lines the body is empty → null
    expect(result).toBeNull()
  })
})

// thread.replied stays a no-op (Task 12 decision) — coverage lives in
// tests/unit/nylas-dispatch.test.ts ("thread.replied — is a no-op seam:
// recordDeliveryEvent NOT called, returns 0"). No test here would add value.
