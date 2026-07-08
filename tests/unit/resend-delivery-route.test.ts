/**
 * Unit tests for the refactored Resend webhook route (Task 6 Part 3):
 * `POST` in `app/api/webhooks/resend/inbound/route.ts`.
 *
 * Seams (all mocked):
 *   - `verifyResendWebhook` — signature verification (no real Svix)
 *   - `ingestInboundFromEvent` — inbound email path
 *   - `ingestResendDeliveryEvent` — delivery event path
 *
 * Handler-level tests (ingestResendDeliveryEvent logic) live in
 * `tests/unit/resend-delivery-handler.test.ts` to avoid a single-file
 * mock conflict (the route tests mock ingestResendDeliveryEvent as a whole
 * while the handler tests need the real implementation with mocked deps).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── hoisted mocks ─────────────────────────────────────────────────────────

const mockVerifyResendWebhook = vi.hoisted(() => vi.fn())
const mockIngestInboundFromEvent = vi.hoisted(() => vi.fn())
const mockIngestResendDeliveryEvent = vi.hoisted(() => vi.fn())

const mockEnv = vi.hoisted(() => ({
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM_EMAIL: "noreply@mail.kandkphotography.com",
  RESEND_WEBHOOK_SECRET: "whsec_test_secret",
}))

// ─── vi.mock declarations ──────────────────────────────────────────────────

vi.mock("@/modules/email-log/inbound", () => ({
  verifyResendWebhook: mockVerifyResendWebhook,
  ingestInboundFromEvent: mockIngestInboundFromEvent,
}))

vi.mock("@/modules/email-delivery/resend-delivery", () => ({
  ingestResendDeliveryEvent: mockIngestResendDeliveryEvent,
}))

vi.mock("@/lib/env", () => ({ env: mockEnv }))
vi.mock("@/lib/db", () => ({ db: {} }))
vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// ─── imports (after vi.mock) ───────────────────────────────────────────────

import { POST } from "@/app/api/webhooks/resend/inbound/route"

// ─── helpers ──────────────────────────────────────────────────────────────

function makeRequest(body: string, svixId = "svix_test_id") {
  return new Request("https://example.com/webhooks/resend/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": svixId,
      "svix-timestamp": "1234567890",
      "svix-signature": "v1,test_sig",
    },
    body,
  })
}

// ─── Route tests ──────────────────────────────────────────────────────────

describe("POST /api/webhooks/resend/inbound — route branching (Part 3)", () => {
  beforeEach(() => {
    mockVerifyResendWebhook.mockReset()
    mockIngestInboundFromEvent.mockReset()
    mockIngestResendDeliveryEvent.mockReset()

    mockIngestInboundFromEvent.mockResolvedValue(undefined)
    mockIngestResendDeliveryEvent.mockResolvedValue(undefined)
  })

  it("acks 200 when verifyResendWebhook returns null (bad signature)", async () => {
    mockVerifyResendWebhook.mockReturnValue(null)

    const res = await POST(makeRequest('{"type":"email.received"}'))

    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown
    expect(body).toEqual({ ok: true })
    expect(mockIngestInboundFromEvent).not.toHaveBeenCalled()
    expect(mockIngestResendDeliveryEvent).not.toHaveBeenCalled()
  })

  it("routes email.bounced to ingestResendDeliveryEvent with svix-id as providerEventId", async () => {
    const event = { type: "email.bounced", data: { email_id: "re_abc" } }
    mockVerifyResendWebhook.mockReturnValue(event)

    const res = await POST(makeRequest(JSON.stringify(event), "svix_bounce_42"))

    expect(res.status).toBe(200)
    expect(mockIngestResendDeliveryEvent).toHaveBeenCalledOnce()
    expect(mockIngestResendDeliveryEvent).toHaveBeenCalledWith(event, "svix_bounce_42")
    expect(mockIngestInboundFromEvent).not.toHaveBeenCalled()
  })

  it("routes email.complained to ingestResendDeliveryEvent", async () => {
    const event = { type: "email.complained", data: { email_id: "re_xyz" } }
    mockVerifyResendWebhook.mockReturnValue(event)

    const res = await POST(makeRequest(JSON.stringify(event)))

    expect(res.status).toBe(200)
    expect(mockIngestResendDeliveryEvent).toHaveBeenCalledOnce()
    expect(mockIngestInboundFromEvent).not.toHaveBeenCalled()
  })

  it("routes email.delivered to ingestResendDeliveryEvent", async () => {
    const event = { type: "email.delivered", data: { email_id: "re_xyz" } }
    mockVerifyResendWebhook.mockReturnValue(event)

    const res = await POST(makeRequest(JSON.stringify(event)))

    expect(res.status).toBe(200)
    expect(mockIngestResendDeliveryEvent).toHaveBeenCalledOnce()
    expect(mockIngestInboundFromEvent).not.toHaveBeenCalled()
  })

  it("routes email.received to ingestInboundFromEvent", async () => {
    const event = { type: "email.received", data: { email_id: "re_inbound" } }
    mockVerifyResendWebhook.mockReturnValue(event)

    const res = await POST(makeRequest(JSON.stringify(event)))

    expect(res.status).toBe(200)
    expect(mockIngestInboundFromEvent).toHaveBeenCalledOnce()
    expect(mockIngestInboundFromEvent).toHaveBeenCalledWith(event)
    expect(mockIngestResendDeliveryEvent).not.toHaveBeenCalled()
  })

  it("routes unknown event type to ingestInboundFromEvent (no-op path)", async () => {
    const event = { type: "email.opened", data: {} }
    mockVerifyResendWebhook.mockReturnValue(event)

    const res = await POST(makeRequest(JSON.stringify(event)))

    expect(res.status).toBe(200)
    expect(mockIngestInboundFromEvent).toHaveBeenCalledOnce()
    expect(mockIngestResendDeliveryEvent).not.toHaveBeenCalled()
  })

  it("acks 200 even when the handler throws", async () => {
    const event = { type: "email.delivered", data: { email_id: "re_xyz" } }
    mockVerifyResendWebhook.mockReturnValue(event)
    mockIngestResendDeliveryEvent.mockRejectedValue(new Error("DB unavailable"))

    const res = await POST(makeRequest(JSON.stringify(event)))

    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown
    expect(body).toEqual({ ok: true })
  })
})
