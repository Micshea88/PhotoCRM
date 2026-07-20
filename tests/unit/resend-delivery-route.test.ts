/**
 * Unit tests for the Resend webhook route:
 * `POST` in `app/api/webhooks/resend/inbound/route.ts`.
 *
 * The route now follows the durable-queue "claim-check" pipeline: it
 * Svix-verifies and ENQUEUES a null-org `resend_webhook` system job — it does
 * NOT process inline. The delivery-vs-inbound branch moved to the async queue
 * handler (covered by `tests/integration/resend-webhook-queue.test.ts`).
 *
 * Seams (all mocked):
 *   - `verifyResendWebhook` — signature verification (no real Svix)
 *   - `enqueueJobInContext` — the durable-queue producer
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── hoisted mocks ─────────────────────────────────────────────────────────

const mockVerifyResendWebhook = vi.hoisted(() => vi.fn())
const mockEnqueueJobInContext = vi.hoisted(() => vi.fn())

// ─── vi.mock declarations ──────────────────────────────────────────────────

vi.mock("@/modules/email-log/inbound", () => ({
  verifyResendWebhook: mockVerifyResendWebhook,
}))
vi.mock("@/modules/jobs/queue/runner", () => ({
  enqueueJobInContext: mockEnqueueJobInContext,
}))
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

describe("POST /api/webhooks/resend/inbound — durable-queue routing", () => {
  beforeEach(() => {
    mockVerifyResendWebhook.mockReset()
    mockEnqueueJobInContext.mockReset()
    mockEnqueueJobInContext.mockResolvedValue({ id: "job_1", enqueued: true })
  })

  it("acks 200 and does NOT enqueue when the signature is bad", async () => {
    mockVerifyResendWebhook.mockReturnValue(null)

    const res = await POST(makeRequest('{"type":"email.received"}'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockEnqueueJobInContext).not.toHaveBeenCalled()
  })

  it("enqueues a null-org resend_webhook job keyed on the svix-id for a verified event", async () => {
    const event = { type: "email.bounced", data: { email_id: "re_abc" } }
    mockVerifyResendWebhook.mockReturnValue(event)
    const body = JSON.stringify(event)

    const res = await POST(makeRequest(body, "svix_bounce_42"))

    expect(res.status).toBe(200)
    expect(mockEnqueueJobInContext).toHaveBeenCalledOnce()
    // Tenant-agnostic system-inbox job; raw body + svix id in the payload; the
    // handler resolves the tenant + branches by type.
    expect(mockEnqueueJobInContext).toHaveBeenCalledWith({
      organizationId: null,
      type: "resend_webhook",
      payload: { rawBody: body, svixId: "svix_bounce_42" },
      idempotencyKey: "svix_bounce_42",
    })
  })

  it("acks 200 even when the enqueue throws (never disables the endpoint)", async () => {
    mockVerifyResendWebhook.mockReturnValue({ type: "email.delivered" })
    mockEnqueueJobInContext.mockRejectedValue(new Error("DB unavailable"))

    const res = await POST(makeRequest('{"type":"email.delivered"}'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
