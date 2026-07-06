/**
 * Unit tests for the `ingestNylasWebhook` dispatch-by-event.type refactor
 * (Task 7).
 *
 * Tests the new dispatch branches in isolation: message.bounce_detected,
 * message.send_failed, message.created routing, grant.expired / thread.replied
 * SEAMS, unknown types, and drop conditions.
 *
 * Seams mocked (all are external deps of nylas-inbound.ts):
 *   - `findEmailLogByNylasMessageIdAnyOrg` — cross-org resolver
 *   - `recordDeliveryEvent`                — delivery event writer
 *   - `nylasFetchMessage`                  — Nylas API fetch (inbound path)
 *   - `findLiveConnectionByAddressAnyOrg`  — connection resolver (inbound path)
 *   - `processInboundEmail`                — inbound processor (inbound path)
 *   - `classifyBounceClass`                — bounce class inference (real impl)
 *
 * Signature verification uses a REAL HMAC computed with the test secret — this
 * exercises `verifyNylasSignature` without mocking it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHmac } from "node:crypto"
import type { DeliveryEventInput } from "@/modules/email-delivery/ingest"

// ─── hoisted mocks ─────────────────────────────────────────────────────────

const mockFindEmailLogByNylasMessageIdAnyOrg = vi.hoisted(() => vi.fn())
const mockRecordDeliveryEvent = vi.hoisted(() => vi.fn())
const mockNylasFetchMessage = vi.hoisted(() => vi.fn())
const mockFindLiveConnectionByAddressAnyOrg = vi.hoisted(() => vi.fn())
const mockProcessInboundEmail = vi.hoisted(() => vi.fn())

// Must be a literal here — vi.hoisted runs before any const declarations.
const mockEnv = vi.hoisted(() => ({
  NYLAS_WEBHOOK_SECRET: "test_nylas_secret_for_unit_tests",
}))

// Used in test helpers (not in vi.hoisted, so safe to declare here).
const TEST_SECRET = "test_nylas_secret_for_unit_tests"

// ─── vi.mock declarations ──────────────────────────────────────────────────

vi.mock("@/modules/email-log/queries", () => ({
  findEmailLogByNylasMessageIdAnyOrg: mockFindEmailLogByNylasMessageIdAnyOrg,
}))

vi.mock("@/modules/email-delivery/ingest", () => ({
  recordDeliveryEvent: mockRecordDeliveryEvent,
  // Keep classifyBounceClass's actual logic for realistic mapping assertions.
  classifyBounceClass: (data: unknown): "hard" | "soft" | null => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null
    const d = data as Record<string, unknown>
    const raw = d.bounceType ?? d.type ?? d.bounce_type
    if (raw === "hard" || raw === "permanent") return "hard"
    if (raw === "soft" || raw === "transient") return "soft"
    if (d.detail && typeof d.detail === "object") {
      const dd = d.detail as Record<string, unknown>
      const inner = dd.type ?? dd.bounceType ?? dd.bounce_type
      if (inner === "hard" || inner === "permanent") return "hard"
      if (inner === "soft" || inner === "transient") return "soft"
    }
    return null
  },
}))

vi.mock("@/lib/env", () => ({ env: mockEnv }))
vi.mock("@/lib/db", () => ({ db: {} }))
vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// Mock external deps used by ingestNylasInboundMessage (the message.created branch).
vi.mock("@/lib/email/nylas", () => ({
  nylasFetchMessage: mockNylasFetchMessage,
}))
vi.mock("@/modules/email-connections/queries", () => ({
  findLiveConnectionByAddressAnyOrg: mockFindLiveConnectionByAddressAnyOrg,
}))
vi.mock("@/modules/email-log/inbound", () => ({
  processInboundEmail: mockProcessInboundEmail,
}))

// ─── imports (after vi.mock) ───────────────────────────────────────────────

import { ingestNylasWebhook } from "@/modules/email-connections/nylas-inbound"

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Build a signed raw body for a given payload using the test secret.
 * Returns both the JSON body string and the correct HMAC-SHA256 hex signature.
 */
function makeSignedBody(payload: object): { body: string; sig: string } {
  const body = JSON.stringify(payload)
  const sig = createHmac("sha256", TEST_SECRET).update(body).digest("hex")
  return { body, sig }
}

// ─── tests ────────────────────────────────────────────────────────────────

describe("ingestNylasWebhook — dispatch by event.type (Task 7)", () => {
  beforeEach(() => {
    mockFindEmailLogByNylasMessageIdAnyOrg.mockReset()
    mockRecordDeliveryEvent.mockReset()
    mockNylasFetchMessage.mockReset()
    mockFindLiveConnectionByAddressAnyOrg.mockReset()
    mockProcessInboundEmail.mockReset()
    mockRecordDeliveryEvent.mockResolvedValue({ recorded: true })
    // message.created path: nylasFetchMessage returns null by default → returns 0
    mockNylasFetchMessage.mockResolvedValue(null)
  })

  // ── Signature + parse guards ─────────────────────────────────────────────

  it("returns 0 and does nothing when signature is invalid", async () => {
    const { body } = makeSignedBody({ type: "message.bounce_detected" })
    // Pass a clearly wrong signature
    const result = await ingestNylasWebhook(body, "wrong_signature_hex_value")
    expect(result).toBe(0)
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
    expect(mockNylasFetchMessage).not.toHaveBeenCalled()
  })

  it("returns 0 and does nothing when body is unparseable JSON", async () => {
    const body = "not valid json{{{"
    // Compute a valid sig for the bad body so the parse guard is reached
    const sig = createHmac("sha256", TEST_SECRET).update(body).digest("hex")
    const result = await ingestNylasWebhook(body, sig)
    expect(result).toBe(0)
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
  })

  // ── message.created routes to ingestNylasInboundMessage ─────────────────

  it("message.created — routes to inbound helper (nylasFetchMessage called, recordDeliveryEvent NOT called)", async () => {
    const { body, sig } = makeSignedBody({
      type: "message.created",
      data: { object: { grant_id: "g_1", id: "msg_abc" } },
    })

    await ingestNylasWebhook(body, sig)

    // nylasFetchMessage is the first external call in ingestNylasInboundMessage
    expect(mockNylasFetchMessage).toHaveBeenCalledWith("g_1", "msg_abc")
    // Must NOT have taken the delivery path
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
    expect(mockFindEmailLogByNylasMessageIdAnyOrg).not.toHaveBeenCalled()
  })

  // ── message.bounce_detected ───────────────────────────────────────────────

  it("message.bounce_detected — calls recordDeliveryEvent with path:nylas, type:bounced, correct org/emailLogId", async () => {
    const orgId = "org_bounce_test"
    const emailLogId = "log_bounce_123"
    mockFindEmailLogByNylasMessageIdAnyOrg.mockResolvedValue({
      id: emailLogId,
      organizationId: orgId,
    })

    const { body, sig } = makeSignedBody({
      type: "message.bounce_detected",
      id: "nylas_evt_bounce_1",
      data: { object: { message_id: "nylas_msg_id_bounce_1", bounce_type: "hard" } },
    })

    const result = await ingestNylasWebhook(body, sig)

    expect(mockFindEmailLogByNylasMessageIdAnyOrg).toHaveBeenCalledWith(
      expect.anything(), // db handle
      "nylas_msg_id_bounce_1",
    )
    expect(mockRecordDeliveryEvent).toHaveBeenCalledOnce()
    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.type).toBe("bounced")
    expect(call.path).toBe("nylas")
    expect(call.organizationId).toBe(orgId)
    expect(call.emailLogId).toBe(emailLogId)
    expect(result).toBe(1)
  })

  it("message.bounce_detected — classifies bounce_type:hard → bounceClass:hard", async () => {
    mockFindEmailLogByNylasMessageIdAnyOrg.mockResolvedValue({
      id: "log_hard",
      organizationId: "org_hard",
    })

    const { body, sig } = makeSignedBody({
      type: "message.bounce_detected",
      data: { object: { message_id: "nylas_msg_hard", bounce_type: "hard" } },
    })

    await ingestNylasWebhook(body, sig)

    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.bounceClass).toBe("hard")
  })

  it("message.bounce_detected — falls back to object.id when message_id is absent", async () => {
    mockFindEmailLogByNylasMessageIdAnyOrg.mockResolvedValue({
      id: "log_fallback",
      organizationId: "org_fallback",
    })

    // Only id, no message_id
    const { body, sig } = makeSignedBody({
      type: "message.bounce_detected",
      data: { object: { id: "nylas_obj_id_fallback" } },
    })

    await ingestNylasWebhook(body, sig)

    expect(mockFindEmailLogByNylasMessageIdAnyOrg).toHaveBeenCalledWith(
      expect.anything(),
      "nylas_obj_id_fallback",
    )
    expect(mockRecordDeliveryEvent).toHaveBeenCalledOnce()
  })

  it("message.bounce_detected — uses top-level event.id as providerEventId when present", async () => {
    mockFindEmailLogByNylasMessageIdAnyOrg.mockResolvedValue({
      id: "log_dedup",
      organizationId: "org_dedup",
    })

    const { body, sig } = makeSignedBody({
      type: "message.bounce_detected",
      id: "nylas_top_level_evt_id",
      data: { object: { message_id: "nylas_msg_dedup" } },
    })

    await ingestNylasWebhook(body, sig)

    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.providerEventId).toBe("nylas_top_level_evt_id")
  })

  it("message.bounce_detected — falls back to <msgId>:bounced as providerEventId when event.id absent", async () => {
    mockFindEmailLogByNylasMessageIdAnyOrg.mockResolvedValue({
      id: "log_noid",
      organizationId: "org_noid",
    })

    const { body, sig } = makeSignedBody({
      type: "message.bounce_detected",
      // No top-level id
      data: { object: { message_id: "nylas_msg_noid" } },
    })

    await ingestNylasWebhook(body, sig)

    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.providerEventId).toBe("nylas_msg_noid:bounced")
  })

  // ── message.send_failed ───────────────────────────────────────────────────

  it("message.send_failed — calls recordDeliveryEvent with type:failed", async () => {
    mockFindEmailLogByNylasMessageIdAnyOrg.mockResolvedValue({
      id: "log_fail_456",
      organizationId: "org_fail_xyz",
    })

    const { body, sig } = makeSignedBody({
      type: "message.send_failed",
      data: { object: { message_id: "nylas_msg_fail_1" } },
    })

    const result = await ingestNylasWebhook(body, sig)

    expect(mockRecordDeliveryEvent).toHaveBeenCalledOnce()
    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.type).toBe("failed")
    expect(call.path).toBe("nylas")
    expect(result).toBe(1)
  })

  it("message.send_failed — bounceClass is null (not applicable to failed events)", async () => {
    mockFindEmailLogByNylasMessageIdAnyOrg.mockResolvedValue({
      id: "log_fail_nc",
      organizationId: "org_fail_nc",
    })

    const { body, sig } = makeSignedBody({
      type: "message.send_failed",
      data: { object: { message_id: "nylas_msg_fail_nc" } },
    })

    await ingestNylasWebhook(body, sig)

    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.bounceClass).toBeNull()
  })

  // ── Unresolvable nylasMessageId drop ─────────────────────────────────────

  it("bounce with unresolvable nylasMessageId — does NOT call recordDeliveryEvent, returns 0, no throw", async () => {
    mockFindEmailLogByNylasMessageIdAnyOrg.mockResolvedValue(null)

    const { body, sig } = makeSignedBody({
      type: "message.bounce_detected",
      data: { object: { message_id: "nylas_msg_pre_feature_ship" } },
    })

    const result = await ingestNylasWebhook(body, sig)

    expect(mockFindEmailLogByNylasMessageIdAnyOrg).toHaveBeenCalledWith(
      expect.anything(),
      "nylas_msg_pre_feature_ship",
    )
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
    expect(result).toBe(0)
  })

  it("bounce with no message_id or id in data.object — does NOT call recordDeliveryEvent, returns 0, no throw", async () => {
    const { body, sig } = makeSignedBody({
      type: "message.bounce_detected",
      data: { object: {} }, // no id or message_id
    })

    const result = await ingestNylasWebhook(body, sig)

    expect(mockFindEmailLogByNylasMessageIdAnyOrg).not.toHaveBeenCalled()
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
    expect(result).toBe(0)
  })

  it("send_failed with unresolvable nylasMessageId — does NOT call recordDeliveryEvent, returns 0", async () => {
    mockFindEmailLogByNylasMessageIdAnyOrg.mockResolvedValue(null)

    const { body, sig } = makeSignedBody({
      type: "message.send_failed",
      data: { object: { message_id: "nylas_msg_unresolvable" } },
    })

    const result = await ingestNylasWebhook(body, sig)

    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
    expect(result).toBe(0)
  })

  // ── grant.expired SEAM ────────────────────────────────────────────────────

  it("grant.expired — is a no-op seam: recordDeliveryEvent NOT called, returns 0", async () => {
    const { body, sig } = makeSignedBody({
      type: "grant.expired",
      data: { object: { grant_id: "g_expired_1" } },
    })

    const result = await ingestNylasWebhook(body, sig)

    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
    expect(mockNylasFetchMessage).not.toHaveBeenCalled()
    expect(result).toBe(0)
  })

  // ── thread.replied SEAM ───────────────────────────────────────────────────

  it("thread.replied — is a no-op seam: recordDeliveryEvent NOT called, returns 0", async () => {
    const { body, sig } = makeSignedBody({
      type: "thread.replied",
      data: { object: { id: "thread_123" } },
    })

    const result = await ingestNylasWebhook(body, sig)

    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
    expect(mockNylasFetchMessage).not.toHaveBeenCalled()
    expect(result).toBe(0)
  })

  // ── Unknown type ──────────────────────────────────────────────────────────

  it("unknown event type — returns 0, nothing called", async () => {
    const { body, sig } = makeSignedBody({
      type: "some.unknown.event",
      data: { object: { id: "something" } },
    })

    const result = await ingestNylasWebhook(body, sig)

    expect(result).toBe(0)
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
    expect(mockNylasFetchMessage).not.toHaveBeenCalled()
  })

  it("missing event type — returns 0, nothing called", async () => {
    const { body, sig } = makeSignedBody({ data: { object: { id: "no_type_here" } } })

    const result = await ingestNylasWebhook(body, sig)

    expect(result).toBe(0)
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
  })
})
