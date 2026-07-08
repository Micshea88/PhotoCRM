/**
 * Task 2B (T2.2) — inbound-email org ROUTING resolution.
 *
 * Proves `processInboundEmail` routes an inbound message to the correct tenant
 * and NEVER cross-org mis-routes. Guards the security property that replaced the
 * old `findContactAnyOrg` "sender, most-recently-updated, across all orgs" bug.
 *
 * Visibility-limitation note (mirrors reply-received.test.ts): `processInboundEmail`
 * uses the module-level `db` (a separate pool from withTestDb), so we mock
 * `@/lib/db` with a configurable in-memory implementation and capture both the
 * `emitNotification` calls and every `email_log` INSERT — letting us assert the
 * resolved org WITHOUT committed Postgres data.
 *
 * Covers the four routing cases from the brief:
 *   1. Nylas lane AUTHORITATIVE — org passed wins even when the sender is a
 *      contact in another org too; logs + notifies the passed org, never the other.
 *   2. Reply ref-match — In-Reply-To resolves to the sending org (ref match wins
 *      over sender ambiguity).
 *   3. Cold ambiguous → DROP — cold inbound, sender in 2 orgs, no org signal →
 *      returns 0, no write, no notification (fail closed, no mis-route).
 *   4. Cold single-org → routed — cold inbound, sender in exactly one org → logs
 *      to that org.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createId } from "@paralleldrive/cuid2"
import type { EmitNotificationInput } from "@/modules/notifications/dispatch"
import type { InboundEmail } from "@/modules/email-log/inbound"

// ─── hoisted mock state ────────────────────────────────────────────────────

const dbMockState = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  txInsertId: "default_email_log_id",
  txInsertCount: 0,
  insertedValues: [] as Record<string, unknown>[],
}))

const mockEmitNotification = vi.hoisted(() => vi.fn().mockResolvedValue({ created: 1 }))

// ─── module mocks ──────────────────────────────────────────────────────────

vi.mock("@/modules/notifications/dispatch", () => ({
  emitNotification: mockEmitNotification,
  emitNotificationInTx: vi.fn(),
}))

vi.mock("@/lib/env", () => ({
  env: { RESEND_API_KEY: "re_test_key", RESEND_WEBHOOK_SECRET: undefined },
}))

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/db", () => {
  function makeChain(result: unknown[]) {
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
        values: (vals: Record<string, unknown>) => {
          const isFirst = dbMockState.txInsertCount === 0
          dbMockState.txInsertCount++
          dbMockState.insertedValues.push(vals)
          const onConflictResult = isFirst ? [{ id: dbMockState.txInsertId }] : []
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
    select: (_cols?: unknown) => makeChain(dbMockState.selectQueue.shift() ?? []),
    transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()),
  }

  return { db }
})

// ─── imports (AFTER vi.mock declarations) ──────────────────────────────────

import { processInboundEmail } from "@/modules/email-log/inbound"

// ─── constants & helpers ────────────────────────────────────────────────────

const ORG_A = "org_alpha"
const ORG_B = "org_beta"
const OWNER_A = "user_owner_a"

const CONTACT_A = { id: "contact_in_a", organizationId: ORG_A, firstName: "Alice", lastName: "A" }

function makeInbound(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    messageId: `<${createId()}@example.com>`,
    from: "shared@example.com",
    to: ["mailbox@studio.com"],
    cc: [],
    subject: "Re: Booking",
    body: "Sounds great!",
    inReplyTo: "<original@studio.com>",
    references: "<original@studio.com>",
    sentAt: new Date("2026-07-04T10:00:00Z"),
    ...overrides,
  }
}

function setupDb(selectQueue: unknown[][], insertId?: string) {
  dbMockState.selectQueue = [...selectQueue]
  dbMockState.txInsertId = insertId ?? createId()
  dbMockState.txInsertCount = 0
  dbMockState.insertedValues = []
}

// ─── tests ────────────────────────────────────────────────────────────────

describe("processInboundEmail — org routing resolution (T2.2)", () => {
  beforeEach(() => {
    mockEmitNotification.mockReset()
    mockEmitNotification.mockResolvedValue({ created: 1 })
    dbMockState.selectQueue = []
    dbMockState.insertedValues = []
    dbMockState.txInsertCount = 0
  })

  // ── 1. Nylas lane authoritative ─────────────────────────────────────────

  it("Nylas lane is authoritative: routes to the passed org, never the other org", async () => {
    // Sender is a contact in BOTH orgs, but org A's mailbox received it.
    // With org A passed, the ONLY sender query is scoped to org A — org B is
    // never consulted; there is no cross-org guessing.
    setupDb([
      [CONTACT_A], // findContactInOrg(ORG_A, from) → sender in A
      [], // dedup
      [{ threadId: "thread_a" }], // thread lookup (reply)
      [], // participant to[0]
    ])

    const result = await processInboundEmail(makeInbound(), "gmail", {
      recipientUserIds: [OWNER_A],
      organizationId: ORG_A,
    })

    expect(result).toBeGreaterThan(0)
    // Written to org A.
    expect(dbMockState.insertedValues[0]!.organizationId).toBe(ORG_A)
    // Notified org A, contact in A — never org B.
    expect(mockEmitNotification).toHaveBeenCalledOnce()
    const call = mockEmitNotification.mock.calls[0]![0] as EmitNotificationInput
    expect(call.organizationId).toBe(ORG_A)
    expect(call.organizationId).not.toBe(ORG_B)
    expect(call.contactId).toBe(CONTACT_A.id)
  })

  // ── 2. Reply ref-match wins ─────────────────────────────────────────────

  it("reply ref-match: In-Reply-To resolves to the sending org (over sender ambiguity)", async () => {
    // No org passed (Resend/shared lane). inReplyTo points at a message org A
    // sent → ref-match resolves org A, even though the sender also exists in B.
    setupDb([
      [{ organizationId: ORG_A }], // findEmailLogOrgByExternalIdsAnyOrg → ORG_A sent the original
      [CONTACT_A], // findContactInOrg(ORG_A, from)
      [], // dedup
      [{ threadId: "thread_a" }], // thread lookup
      [], // participant to[0]
      [{ userId: OWNER_A }], // memberRole fallback (reply, no opts)
    ])

    const result = await processInboundEmail(makeInbound(), "resend")

    expect(result).toBeGreaterThan(0)
    expect(dbMockState.insertedValues[0]!.organizationId).toBe(ORG_A)
    const call = mockEmitNotification.mock.calls[0]![0] as EmitNotificationInput
    expect(call.organizationId).toBe(ORG_A)
  })

  // ── 3. Cold ambiguous → DROP (fail closed) ──────────────────────────────

  it("cold ambiguous sender in multiple orgs → dropped, no write, no notification", async () => {
    // Cold inbound: no In-Reply-To, no References → no ref-match query. Sender
    // is a contact in TWO orgs and there is no deterministic signal → FAIL CLOSED.
    setupDb([
      // findSenderOrgIdsAnyOrg → two distinct orgs
      [{ organizationId: ORG_A }, { organizationId: ORG_B }],
    ])

    const result = await processInboundEmail(
      makeInbound({ inReplyTo: null, references: null }),
      "resend",
    )

    expect(result).toBe(0)
    expect(dbMockState.insertedValues).toHaveLength(0) // no cross-org write
    expect(mockEmitNotification).not.toHaveBeenCalled()
  })

  // ── 4. Cold single-org → routed ─────────────────────────────────────────

  it("cold inbound, sender in exactly one org → logs to that org", async () => {
    setupDb([
      [{ organizationId: ORG_A }], // findSenderOrgIdsAnyOrg → single org
      [CONTACT_A], // findContactInOrg(ORG_A, from)
      [], // dedup
      // no thread lookup (refIds empty)
      [], // participant to[0]
    ])

    const result = await processInboundEmail(
      makeInbound({ inReplyTo: null, references: null }),
      "resend",
    )

    expect(result).toBeGreaterThan(0)
    expect(dbMockState.insertedValues[0]!.organizationId).toBe(ORG_A)
    // Cold inbound (not a reply) → reply_received NOT emitted.
    expect(mockEmitNotification).not.toHaveBeenCalled()
  })
})
