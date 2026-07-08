/**
 * Unit tests for `emitNotification` / `emitNotificationInTx` (Task 10b).
 *
 * Seams (all mocked):
 *   - `@/lib/db`                     — db.transaction stubbed; no real Postgres
 *   - `@/modules/notifications/email` — sendNotificationEmail stubbed
 *   - `@/lib/env`                     — prevents server env guard
 *   - `@/lib/log`                     — no-op log
 *
 * Strategy for emitNotificationInTx:  build a minimal mock `tx` per test with
 * `execute`, `select`, `insert`, and `update` stubs.  The `select` chain uses
 * sequenced `mockResolvedValueOnce` calls so the two per-recipient SELECTs
 * (notification_preferences, then user_preferences) return independent data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const mockSendNotificationEmail = vi.hoisted(() => vi.fn())
const mockDbTransaction = vi.hoisted(() => vi.fn())

// ─── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    RESEND_API_KEY: "re_test_key",
    RESEND_FROM_EMAIL: "noreply@example.com",
    RESEND_FROM_NAME: "",
    DATABASE_URL: "postgres://localhost:5432/pathway_test",
    NODE_ENV: "test",
  },
}))

vi.mock("@/lib/db", () => ({ db: { transaction: mockDbTransaction } }))

vi.mock("@/modules/notifications/email", () => ({
  sendNotificationEmail: mockSendNotificationEmail,
}))

vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// ─── imports (after vi.mock) ──────────────────────────────────────────────────

import { emitNotification, emitNotificationInTx } from "@/modules/notifications/dispatch"
import type { EmitNotificationInput } from "@/modules/notifications/dispatch"
import { db } from "@/lib/db"

// Type alias matching dispatch.ts's internal DbTx (extracted via Parameters).
type MockTx = Parameters<typeof emitNotificationInTx>[0]

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock tx object with configurable select responses.
 * `selectResponses` is consumed left-to-right per .limit(1) call in the
 * function under test.  Insert and update are always tracked.
 */
function makeMockTx(selectResponses: unknown[][] = []) {
  const mockInsertedValues: unknown[] = []
  const mockUpdatedSets: unknown[] = []
  const capturedExecuteSql: unknown[] = []

  let selectCallIdx = 0

  const mockLimit = vi.fn(() => {
    const resp = selectResponses[selectCallIdx] ?? []
    selectCallIdx++
    return Promise.resolve(resp)
  })
  const mockWhere = vi.fn(() => ({ limit: mockLimit }))
  const mockFrom = vi.fn(() => ({ where: mockWhere }))
  const mockSelect = vi.fn(() => ({ from: mockFrom }))

  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined)
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }))
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }))

  const mockInsertValues = vi.fn((vals: unknown) => {
    mockInsertedValues.push(vals)
    return Promise.resolve()
  })
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }))

  const mockExecute = vi.fn((sqlArg: unknown) => {
    capturedExecuteSql.push(sqlArg)
    return Promise.resolve()
  })

  // Cast to MockTx: the real type is NodePgDatabase<schema> which requires many
  // internal Drizzle methods.  Our stub only implements the four methods that
  // emitNotificationInTx actually calls, so a double-cast is required.
  const tx = {
    execute: mockExecute,
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  } as unknown as MockTx

  return {
    tx,
    inserted: mockInsertedValues,
    updated: mockUpdatedSets,
    executedSql: capturedExecuteSql,
    mockInsertValues,
    mockUpdateSet,
    mockUpdateWhere,
  }
}

function baseInput(overrides: Partial<EmitNotificationInput> = {}): EmitNotificationInput {
  return {
    organizationId: "org_test_001",
    type: "email.bounced",
    recipientUserIds: ["user_recipient_1"],
    actorUserId: null,
    title: "Email bounced",
    body: "A client email bounced.",
    linkPath: "/contacts/abc",
    sourceModule: "email",
    ...overrides,
  }
}

// ─── emitNotificationInTx tests ───────────────────────────────────────────────

describe("emitNotificationInTx", () => {
  beforeEach(() => {
    mockSendNotificationEmail.mockReset()
    mockSendNotificationEmail.mockResolvedValue(true)
  })

  it("registry lookup: stamps category and tier from NOTIFICATION_TYPES onto the inserted row", async () => {
    const { tx, inserted } = makeMockTx([
      [], // notification_preferences: no stored pref → use defaults
      [], // user_preferences: no settings
    ])

    await emitNotificationInTx(tx, baseInput())

    expect(inserted).toHaveLength(1)
    const row = inserted[0] as Record<string, unknown>
    expect(row.category).toBe("messages_email") // email.bounced category (Task 15F)
    expect(row.tier).toBe("critical") // email.bounced tier
    expect(row.type).toBe("email.bounced")
  })

  it("throws for an unknown notification type", async () => {
    const { tx } = makeMockTx()

    await expect(emitNotificationInTx(tx, baseInput({ type: "unknown.type.xyz" }))).rejects.toThrow(
      "Unknown notification type: unknown.type.xyz",
    )
  })

  it("persists contactId from input onto the inserted notification row", async () => {
    const { tx, inserted } = makeMockTx([[], []])

    await emitNotificationInTx(tx, baseInput({ contactId: "contact_xyz_123" }))

    const row = inserted[0] as Record<string, unknown>
    expect(row.contactId).toBe("contact_xyz_123")
  })

  it("persists null contactId when input.contactId is omitted", async () => {
    const { tx, inserted } = makeMockTx([[], []])
    const input = baseInput()
    delete (input as unknown as Record<string, unknown>).contactId

    await emitNotificationInTx(tx, input)

    const row = inserted[0] as Record<string, unknown>
    expect(row.contactId).toBeNull()
  })

  // ── Own-action suppression ─────────────────────────────────────────────────

  it("own-action: skips the recipient when recipientUserId === actorUserId", async () => {
    const { tx, inserted } = makeMockTx()

    const result = await emitNotificationInTx(
      tx,
      baseInput({ actorUserId: "user_recipient_1", recipientUserIds: ["user_recipient_1"] }),
    )

    expect(inserted).toHaveLength(0)
    expect(result.created).toBe(0)
    expect(mockSendNotificationEmail).not.toHaveBeenCalled()
  })

  it("own-action: skips the matching recipient but still notifies a different one", async () => {
    const { tx, inserted } = makeMockTx([
      [], // notification_preferences for user_other
      [], // user_preferences for user_other
    ])

    const result = await emitNotificationInTx(
      tx,
      baseInput({
        actorUserId: "user_actor",
        recipientUserIds: ["user_actor", "user_other"],
      }),
    )

    expect(inserted).toHaveLength(1)
    const row = inserted[0] as Record<string, unknown>
    expect(row.recipientUserId).toBe("user_other")
    expect(result.created).toBe(1)
  })

  it("bounce-on-automated: actorUserId is the configuring user, recipients are owner/admins (different IDs) → rows created for all", async () => {
    // Simulates emitting email.bounced for an automated bounce where the
    // configuring user is "user_automator" but owner/admins are notified.
    const { tx, inserted } = makeMockTx([
      [],
      [], // user_owner: no pref, no settings
      [],
      [], // user_admin: no pref, no settings
    ])

    const result = await emitNotificationInTx(
      tx,
      baseInput({
        type: "email.bounced",
        actorUserId: "user_automator",
        recipientUserIds: ["user_owner", "user_admin"],
      }),
    )

    expect(inserted).toHaveLength(2)
    expect(result.created).toBe(2)
    expect((inserted[0] as Record<string, unknown>).recipientUserId).toBe("user_owner")
    expect((inserted[1] as Record<string, unknown>).recipientUserId).toBe("user_admin")
  })

  // ── Preference resolution ─────────────────────────────────────────────────

  it("stored pref {in_app:false, email:true} → no in-app row inserted, but email IS sent", async () => {
    const { tx, inserted } = makeMockTx([
      [{ inApp: false, email: true }], // notification_preferences: email only
      [], // user_preferences: no settings (immediate)
    ])

    const result = await emitNotificationInTx(tx, baseInput())

    expect(inserted).toHaveLength(0)
    expect(result.created).toBe(0)
    expect(mockSendNotificationEmail).toHaveBeenCalledOnce()
  })

  it("no stored pref → uses registry defaults (email.bounced: in_app=true, email=true)", async () => {
    const { tx, inserted } = makeMockTx([
      [], // no pref → use registry defaults
      [], // no settings
    ])

    await emitNotificationInTx(tx, baseInput())

    expect(inserted).toHaveLength(1)
    expect(mockSendNotificationEmail).toHaveBeenCalledOnce()
  })

  it("stored pref {in_app:true, email:false} → in-app row inserted, NO email sent", async () => {
    const { tx, inserted } = makeMockTx([
      [{ inApp: true, email: false }], // notification_preferences: in_app only
      [], // user_preferences
    ])

    await emitNotificationInTx(tx, baseInput())

    expect(inserted).toHaveLength(1)
    expect(mockSendNotificationEmail).not.toHaveBeenCalled()
  })

  // ── Quiet-hours ───────────────────────────────────────────────────────────

  it("critical tier: email sent immediately regardless of quiet hours settings", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-15T23:00:00Z")) // inside 22–7 UTC quiet window

    try {
      const { tx, inserted } = makeMockTx([
        [], // no pref → defaults (in_app:true, email:true for email.bounced)
        [
          {
            value: {
              timezone: "UTC",
              quietHoursStart: 22,
              quietHoursEnd: 7,
              digestFrequency: "off",
            },
          },
        ], // settings with quiet window
      ])

      await emitNotificationInTx(tx, baseInput({ type: "email.bounced" })) // critical

      const row = inserted[0] as Record<string, unknown>
      expect(row.scheduledFor).toBeNull() // critical: always immediate
      expect(mockSendNotificationEmail).toHaveBeenCalledOnce() // email sent now
    } finally {
      vi.useRealTimers()
    }
  })

  it("routine in quiet window: scheduled_for is set AND email is NOT sent now", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-15T23:00:00Z")) // 23:00 UTC inside 22–7 window

    try {
      const { tx, inserted } = makeMockTx([
        [], // no pref → defaults (email.reply_received: in_app:true, email:false)
        [
          {
            value: {
              timezone: "UTC",
              quietHoursStart: 22,
              quietHoursEnd: 7,
              digestFrequency: "off",
            },
          },
        ], // quiet hours active
      ])

      await emitNotificationInTx(tx, baseInput({ type: "email.reply_received" })) // routine

      expect(inserted).toHaveLength(1)
      const row = inserted[0] as Record<string, unknown>
      // Deferred: scheduled_for should be 07:00 UTC on 2026-01-16
      expect(row.scheduledFor).toBeInstanceOf(Date)
      expect((row.scheduledFor as Date).toISOString()).toBe("2026-01-16T07:00:00.000Z")
      // email.reply_received defaultChannels.email = false → no email regardless
      expect(mockSendNotificationEmail).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("routine with email=true in quiet window: in-app row gets scheduled_for, email NOT sent", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-15T23:00:00Z"))

    try {
      const { tx, inserted } = makeMockTx([
        [{ inApp: true, email: true }], // stored pref: both enabled
        [
          {
            value: {
              timezone: "UTC",
              quietHoursStart: 22,
              quietHoursEnd: 7,
              digestFrequency: "off",
            },
          },
        ],
      ])

      // Use a routine type overridden by pref to also have email:true
      await emitNotificationInTx(tx, baseInput({ type: "email.reply_received" }))

      const row = inserted[0] as Record<string, unknown>
      expect(row.scheduledFor).toBeInstanceOf(Date)
      // email NOT sent because scheduledFor is non-null (deferred)
      expect(mockSendNotificationEmail).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("routine outside quiet window: scheduled_for is null AND email is sent (when email channel enabled)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z")) // 12:00 UTC outside 22–7 window

    try {
      const { tx, inserted } = makeMockTx([
        [{ inApp: true, email: true }], // pref with email enabled
        [
          {
            value: {
              timezone: "UTC",
              quietHoursStart: 22,
              quietHoursEnd: 7,
              digestFrequency: "off",
            },
          },
        ],
      ])

      await emitNotificationInTx(tx, baseInput({ type: "email.reply_received" }))

      const row = inserted[0] as Record<string, unknown>
      expect(row.scheduledFor).toBeNull() // outside window → immediate
      expect(mockSendNotificationEmail).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  // ── email_sent_at update ──────────────────────────────────────────────────

  it("sets email_sent_at on the in-app row when email is sent successfully", async () => {
    const { tx, mockUpdateSet } = makeMockTx([[], []])
    mockSendNotificationEmail.mockResolvedValue(true)

    await emitNotificationInTx(tx, baseInput())

    expect(mockUpdateSet).toHaveBeenCalledOnce()
    const updateFields = (mockUpdateSet.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(updateFields.emailSentAt).toBeInstanceOf(Date)
  })

  it("does NOT call update when sendNotificationEmail returns false", async () => {
    const { tx, mockUpdateSet } = makeMockTx([[], []])
    mockSendNotificationEmail.mockResolvedValue(false)

    await emitNotificationInTx(tx, baseInput())

    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  // ── set_config per-recipient ──────────────────────────────────────────────

  it("sets app.current_user_id GUC for each recipient before reads", async () => {
    const { tx, executedSql } = makeMockTx([[], [], [], []])

    await emitNotificationInTx(tx, baseInput({ recipientUserIds: ["user_alpha", "user_beta"] }))

    // Each recipient triggers an execute call with their userId
    const serializedSql = executedSql.map((s) => JSON.stringify(s))
    const userIdSetCalls = serializedSql.filter((s) => s.includes("current_user_id"))
    expect(userIdSetCalls).toHaveLength(2)
    expect(userIdSetCalls[0]).toContain("user_alpha")
    expect(userIdSetCalls[1]).toContain("user_beta")
  })
})

// ─── emitNotification public wrapper test ─────────────────────────────────────
//
// Mirrors delivery-event-helpers.test.ts ("recordDeliveryEvent wrapper" section):
// proves the wrapper opens a transaction, issues set_config for app.current_org
// FIRST, and delegates to emitNotificationInTx.

describe("emitNotification (public wrapper)", () => {
  beforeEach(() => {
    mockSendNotificationEmail.mockReset()
    mockSendNotificationEmail.mockResolvedValue(true)
  })

  it("opens a transaction, sets app.current_org GUC first, then delegates", async () => {
    const orgId = "org_wrapper_dispatch_test"
    const callOrder: string[] = []

    // Capture all SQL args passed to execute — the FIRST should be app.current_org.
    const capturedSqlArgs: unknown[] = []

    const mockTx = {
      execute: vi.fn((arg: unknown) => {
        capturedSqlArgs.push(arg)
        callOrder.push("execute")
        return Promise.resolve()
      }),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      insert: vi.fn(() => {
        callOrder.push("insert")
        return { values: vi.fn().mockResolvedValue(undefined) }
      }),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      })),
    }

    const mockTransaction = vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx))
    ;(db as unknown as Record<string, unknown>).transaction = mockTransaction

    const result = await emitNotification(
      baseInput({
        organizationId: orgId,
        recipientUserIds: ["user_wrap_1"],
        actorUserId: null,
      }),
    )

    // 1. A transaction must have been opened.
    expect(mockTransaction).toHaveBeenCalledOnce()

    // 2. tx.execute must have been called at least once (the GUC set_config calls).
    expect(mockTx.execute).toHaveBeenCalled()

    // 3. The FIRST execute must be the role switch into the NOBYPASSRLS app
    //    role (before any GUC), so FORCE RLS enforces on this system write.
    const firstSql = JSON.stringify(capturedSqlArgs[0])
    expect(firstSql).toContain("SET LOCAL ROLE app_authenticated")

    // 3b. The SECOND execute must set the org GUC before any per-recipient calls.
    const secondSql = JSON.stringify(capturedSqlArgs[1])
    expect(secondSql).toContain("set_config")
    expect(secondSql).toContain(orgId)

    // 4. Delegation: emitNotificationInTx issues an insert → confirm it ran.
    expect(mockTx.insert).toHaveBeenCalled()

    // 5. Ordering: execute (GUC set) BEFORE insert (write).
    expect(callOrder.indexOf("execute")).toBeLessThan(callOrder.indexOf("insert"))

    // 6. Returns { created } from the core writer.
    expect(result).toEqual({ created: 1 })
  })

  it("propagates created:0 when all recipients are suppressed (own-action)", async () => {
    const orgId = "org_suppress_test"

    const mockTx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      })),
      insert: vi.fn(),
      update: vi.fn(),
    }

    ;(db as unknown as Record<string, unknown>).transaction = vi.fn(
      async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    )

    const result = await emitNotification(
      baseInput({
        organizationId: orgId,
        actorUserId: "user_self",
        recipientUserIds: ["user_self"],
      }),
    )

    expect(result).toEqual({ created: 0 })
    expect(mockTx.insert).not.toHaveBeenCalled()
  })
})
