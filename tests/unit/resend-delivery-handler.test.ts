/**
 * Unit tests for `ingestResendDeliveryEvent` (Task 6 Part 3).
 *
 * Tests the handler's own logic in isolation: resolving the email_log row,
 * mapping event types to recordDeliveryEvent inputs, and drop conditions.
 *
 * Seams (mocked):
 *   - `findEmailLogByResendEmailIdAnyOrg` — cross-org resolver
 *   - `recordDeliveryEvent` — delivery event writer
 *   - `classifyBounceClass` — bounce class inference (real impl via spy)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { DeliveryEventInput } from "@/modules/email-delivery/ingest"

// ─── hoisted mocks ─────────────────────────────────────────────────────────

const mockFindEmailLogByResendEmailIdAnyOrg = vi.hoisted(() => vi.fn())
const mockRecordDeliveryEvent = vi.hoisted(() => vi.fn())

const mockEnv = vi.hoisted(() => ({
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM_EMAIL: "noreply@mail.kandkphotography.com",
  RESEND_WEBHOOK_SECRET: "whsec_test_secret",
}))

// ─── vi.mock declarations ──────────────────────────────────────────────────

vi.mock("@/modules/email-log/queries", () => ({
  findEmailLogByResendEmailIdAnyOrg: mockFindEmailLogByResendEmailIdAnyOrg,
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
    return null
  },
}))

vi.mock("@/lib/env", () => ({ env: mockEnv }))
vi.mock("@/lib/db", () => ({ db: {} }))
vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// ─── imports (after vi.mock) ───────────────────────────────────────────────

import { ingestResendDeliveryEvent } from "@/modules/email-delivery/resend-delivery"

// ─── tests ────────────────────────────────────────────────────────────────

describe("ingestResendDeliveryEvent — handler logic (Part 3)", () => {
  beforeEach(() => {
    mockFindEmailLogByResendEmailIdAnyOrg.mockReset()
    mockRecordDeliveryEvent.mockReset()
    mockRecordDeliveryEvent.mockResolvedValue({ recorded: true })
  })

  it("calls recordDeliveryEvent with type:bounced + hard bounceClass for email.bounced", async () => {
    const orgId = "org_abc"
    const emailLogId = "log_123"
    mockFindEmailLogByResendEmailIdAnyOrg.mockResolvedValue({
      id: emailLogId,
      organizationId: orgId,
    })

    const event = {
      type: "email.bounced",
      data: { email_id: "re_abc123", bounceType: "hard", created_at: "2026-07-04T10:00:00Z" },
    }

    await ingestResendDeliveryEvent(event, "svix_prov_99")

    expect(mockFindEmailLogByResendEmailIdAnyOrg).toHaveBeenCalledWith(
      expect.anything(), // db handle
      "re_abc123",
    )
    expect(mockRecordDeliveryEvent).toHaveBeenCalledOnce()
    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.type).toBe("bounced")
    expect(call.bounceClass).toBe("hard")
    expect(call.organizationId).toBe(orgId)
    expect(call.emailLogId).toBe(emailLogId)
    expect(call.path).toBe("resend")
    expect(call.providerEventId).toBe("svix_prov_99")
    expect(call.occurredAt).toEqual(new Date("2026-07-04T10:00:00Z"))
  })

  it("maps bounceType:soft → bounceClass:soft", async () => {
    mockFindEmailLogByResendEmailIdAnyOrg.mockResolvedValue({
      id: "log_soft",
      organizationId: "org_soft",
    })

    const event = {
      type: "email.bounced",
      data: { email_id: "re_soft", bounceType: "soft" },
    }

    await ingestResendDeliveryEvent(event, null)

    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.bounceClass).toBe("soft")
  })

  it("calls recordDeliveryEvent with type:delivered for email.delivered", async () => {
    mockFindEmailLogByResendEmailIdAnyOrg.mockResolvedValue({
      id: "log_456",
      organizationId: "org_xyz",
    })

    const event = {
      type: "email.delivered",
      data: { email_id: "re_delivered_01", created_at: "2026-07-04T11:00:00Z" },
    }

    await ingestResendDeliveryEvent(event, "svix_del_01")

    expect(mockRecordDeliveryEvent).toHaveBeenCalledOnce()
    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.type).toBe("delivered")
    expect(call.organizationId).toBe("org_xyz")
    expect(call.emailLogId).toBe("log_456")
  })

  it("calls recordDeliveryEvent with type:complained for email.complained", async () => {
    mockFindEmailLogByResendEmailIdAnyOrg.mockResolvedValue({
      id: "log_789",
      organizationId: "org_spam",
    })

    const event = {
      type: "email.complained",
      data: { email_id: "re_spam_01" },
    }

    await ingestResendDeliveryEvent(event, null)

    expect(mockRecordDeliveryEvent).toHaveBeenCalledOnce()
    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.type).toBe("complained")
    expect(call.providerEventId).toBeNull()
  })

  it("drops and does NOT call recordDeliveryEvent when email_id is missing", async () => {
    const event = { type: "email.bounced", data: {} }

    await ingestResendDeliveryEvent(event, "svix_99")

    expect(mockFindEmailLogByResendEmailIdAnyOrg).not.toHaveBeenCalled()
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
  })

  it("drops and does NOT call recordDeliveryEvent when no email_log match is found", async () => {
    mockFindEmailLogByResendEmailIdAnyOrg.mockResolvedValue(null)

    const event = {
      type: "email.delivered",
      data: { email_id: "re_pre_fix_send" },
    }

    await ingestResendDeliveryEvent(event, "svix_drop")

    expect(mockFindEmailLogByResendEmailIdAnyOrg).toHaveBeenCalledWith(
      expect.anything(),
      "re_pre_fix_send",
    )
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
  })

  it("no-ops for non-delivery event types (e.g. email.received)", async () => {
    const event = { type: "email.received", data: { email_id: "re_inbound" } }

    await ingestResendDeliveryEvent(event, null)

    expect(mockFindEmailLogByResendEmailIdAnyOrg).not.toHaveBeenCalled()
    expect(mockRecordDeliveryEvent).not.toHaveBeenCalled()
  })

  it("uses event-level created_at as occurredAt when data.created_at is absent", async () => {
    mockFindEmailLogByResendEmailIdAnyOrg.mockResolvedValue({
      id: "log_evtlevel",
      organizationId: "org_evtlevel",
    })

    const event = {
      type: "email.delivered",
      created_at: "2026-07-04T09:00:00Z",
      data: { email_id: "re_evtlevel" },
    }

    await ingestResendDeliveryEvent(event, null)

    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.occurredAt).toEqual(new Date("2026-07-04T09:00:00Z"))
  })

  it("falls back to Date.now() when no created_at timestamp is present", async () => {
    mockFindEmailLogByResendEmailIdAnyOrg.mockResolvedValue({
      id: "log_ts",
      organizationId: "org_ts",
    })

    const before = Date.now()
    const event = { type: "email.delivered", data: { email_id: "re_no_ts" } }
    await ingestResendDeliveryEvent(event, null)
    const after = Date.now()

    const call = mockRecordDeliveryEvent.mock.calls[0]![0] as DeliveryEventInput
    expect(call.occurredAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(call.occurredAt.getTime()).toBeLessThanOrEqual(after)
  })
})
