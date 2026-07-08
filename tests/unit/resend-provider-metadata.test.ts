/**
 * Unit tests for Part 1 of Task 6 — resendFallbackProvider captures
 * Resend's email_id and stores it in externalMetadata.
 *
 * Seam: `sendEmail` (src/lib/email.ts) is mocked so we never touch real Resend.
 * We test our wrapper's behavior:
 *   1. When sendEmail returns { id: "re_abc123" }, resendFallbackProvider.send()
 *      returns externalMetadata: { resendEmailId: "re_abc123" }.
 *   2. source is still "resend".
 *   3. externalId is the minted Message-ID (<cuid@domain>), unchanged.
 *   4. threadId === externalId (thread root = its own id).
 *
 * Note: sendEmail throws on Resend API error and returns CreateEmailResponseSuccess
 * (non-null with a required `id: string`), so there is no null/missing-id branch
 * to test — the type guarantees it is always present.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted: runs before vi.mock factories so these refs are available inside
// factory closures.
const mockSendEmail = vi.hoisted(() => vi.fn())
const mockEnv = vi.hoisted(() => ({
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM_EMAIL: "noreply@mail.kandkphotography.com",
  RESEND_FROM_NAME: "K&K Photography",
  RESEND_WEBHOOK_SECRET: "whsec_test",
}))

vi.mock("@/lib/email", () => ({ sendEmail: mockSendEmail }))
vi.mock("@/lib/env", () => ({ env: mockEnv }))

// Nylas is imported by provider.ts; mock to avoid any real connection.
vi.mock("@/lib/email/nylas", () => ({
  nylasSendMessage: vi.fn().mockResolvedValue({
    nylasMessageId: "nylas_msg",
    nylasThreadId: "nylas_thread",
    rfcMessageId: null,
  }),
}))

// DB is needed by resolveSenderForUser — not exercised here, but mock to
// satisfy server-only imports.
vi.mock("@/lib/db", () => ({ db: {} }))
vi.mock("@/modules/email-connections/queries", () => ({
  getLiveConnectionForUser: vi.fn().mockResolvedValue(null),
  isSendable: vi.fn().mockReturnValue(false),
  decryptGrantId: vi.fn(),
}))

// We need to reach the unexported `resendFallbackProvider`. Since it's not
// exported, we test it indirectly through `resolveSenderForUser` which
// returns the resend fallback when no live connection exists.
import { resolveSenderForUser } from "@/lib/email/provider"

const sampleMsg = {
  to: ["client@example.com"],
  cc: [],
  bcc: [],
  subject: "Test",
  html: "<p>Hello</p>",
  attachments: [],
}

describe("resendFallbackProvider — externalMetadata capture (Part 1)", () => {
  beforeEach(() => {
    mockSendEmail.mockReset()
  })

  it("stores resendEmailId in externalMetadata when sendEmail returns an id", async () => {
    mockSendEmail.mockResolvedValue({ id: "re_abc123" })

    const { provider } = await resolveSenderForUser({} as never, {
      orgId: "org_1",
      userId: "user_1",
      photographerName: "Kelly Shea",
      businessName: "K&K Photography",
    })

    const ref = await provider.send(sampleMsg)

    expect(ref.externalMetadata).toEqual({ resendEmailId: "re_abc123" })
  })

  it("source is always 'resend' for the fallback provider", async () => {
    mockSendEmail.mockResolvedValue({ id: "re_xyz" })

    const { provider } = await resolveSenderForUser({} as never, {
      orgId: "org_1",
      userId: "user_1",
      photographerName: "Kelly Shea",
      businessName: "K&K Photography",
    })

    const ref = await provider.send(sampleMsg)

    expect(ref.source).toBe("resend")
  })

  it("externalId is the minted Message-ID (not the resend id)", async () => {
    mockSendEmail.mockResolvedValue({ id: "re_xyz" })

    const { provider } = await resolveSenderForUser({} as never, {
      orgId: "org_1",
      userId: "user_1",
      photographerName: "Kelly Shea",
      businessName: "K&K Photography",
    })

    const ref = await provider.send(sampleMsg)

    // The minted id is a cuid wrapped in angle-bracket RFC format.
    expect(ref.externalId).toMatch(/^<.+@.+>$/)
    // It must NOT be the resend id.
    expect(ref.externalId).not.toBe("re_xyz")
  })

  it("threadId equals externalId (thread root)", async () => {
    mockSendEmail.mockResolvedValue({ id: "re_xyz" })

    const { provider } = await resolveSenderForUser({} as never, {
      orgId: "org_1",
      userId: "user_1",
      photographerName: "Kelly Shea",
      businessName: "K&K Photography",
    })

    const ref = await provider.send(sampleMsg)

    expect(ref.threadId).toBe(ref.externalId)
  })
})
