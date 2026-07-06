/**
 * Unit tests for `sendNotificationEmail` (Task 10b — notifications/email.ts).
 *
 * Seams (all mocked):
 *   - `@/lib/db`    — prevents server env guard; db.select is stubbed per test
 *   - `@/lib/email` — no real Resend calls
 *   - `@/lib/env`   — provides deterministic NEXT_PUBLIC_APP_URL
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const mockSendEmail = vi.hoisted(() => vi.fn())
const mockLimit = vi.hoisted(() => vi.fn())

// ─── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    RESEND_API_KEY: "re_test_key",
    RESEND_FROM_EMAIL: "noreply@example.com",
    RESEND_FROM_NAME: "",
  },
}))

vi.mock("@/lib/email", () => ({ sendEmail: mockSendEmail }))

// Stub the db.select chain: db.select({}).from(user).where(cond).limit(1)
vi.mock("@/lib/db", () => {
  const mockWhere = vi.fn(() => ({ limit: mockLimit }))
  const mockFrom = vi.fn(() => ({ where: mockWhere }))
  const mockSelect = vi.fn(() => ({ from: mockFrom }))
  return { db: { select: mockSelect } }
})

// ─── imports (after vi.mock) ──────────────────────────────────────────────────

import { sendNotificationEmail } from "@/modules/notifications/email"

// ─── tests ────────────────────────────────────────────────────────────────────

describe("sendNotificationEmail", () => {
  beforeEach(() => {
    mockSendEmail.mockReset()
    mockLimit.mockReset()
    mockSendEmail.mockResolvedValue({ id: "email_mock_id" })
  })

  it("returns false and does NOT call sendEmail when recipient has no email", async () => {
    mockLimit.mockResolvedValue([]) // no user row found

    const result = await sendNotificationEmail("user_no_email", "Test title", "Body text")

    expect(result).toBe(false)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("returns false and does NOT call sendEmail when row has no email field", async () => {
    mockLimit.mockResolvedValue([{ email: null }])

    const result = await sendNotificationEmail("user_null_email", "Test title", null)

    expect(result).toBe(false)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("calls sendEmail with correct params and returns true when user has email", async () => {
    mockLimit.mockResolvedValue([{ email: "recipient@example.com" }])

    const result = await sendNotificationEmail(
      "user_abc",
      "Email bounced",
      "Your email failed.",
      null,
    )

    expect(result).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledOnce()
    const call = mockSendEmail.mock.calls[0]![0] as Record<string, unknown>
    expect(call.to).toBe("recipient@example.com")
    expect(call.subject).toBe("Email bounced")
    expect(typeof call.html).toBe("string")
    expect(call.html).toContain("Email bounced")
    expect(call.html).toContain("Your email failed.")
  })

  it("includes a link when linkPath is provided", async () => {
    mockLimit.mockResolvedValue([{ email: "link@example.com" }])

    await sendNotificationEmail("user_link", "Alert", "Something happened", "/notifications/123")

    const call = mockSendEmail.mock.calls[0]![0] as Record<string, unknown>
    expect(call.html as string).toContain("https://app.example.com/notifications/123")
    expect(call.html as string).toContain("View in Pathway")
  })

  it("omits the link section when linkPath is null", async () => {
    mockLimit.mockResolvedValue([{ email: "nolink@example.com" }])

    await sendNotificationEmail("user_nolink", "Alert", "Something happened", null)

    const call = mockSendEmail.mock.calls[0]![0] as Record<string, unknown>
    expect(call.html as string).not.toContain("View in Pathway")
  })

  it("omits the link section when linkPath is undefined", async () => {
    mockLimit.mockResolvedValue([{ email: "nolink2@example.com" }])

    await sendNotificationEmail("user_nolink2", "Alert", null)

    const call = mockSendEmail.mock.calls[0]![0] as Record<string, unknown>
    expect(call.html as string).not.toContain("View in Pathway")
  })

  it("omits the body paragraph when body is null", async () => {
    mockLimit.mockResolvedValue([{ email: "user@example.com" }])

    await sendNotificationEmail("user_xyz", "Title only", null)

    const call = mockSendEmail.mock.calls[0]![0] as Record<string, unknown>
    const html = call.html as string
    expect(html).toContain("Title only")
    // Body paragraph should not be present (no <p> with undefined/null content)
    expect(html).not.toContain("undefined")
    expect(html).not.toContain("null")
  })

  it("escapes HTML in title and body to prevent injection", async () => {
    mockLimit.mockResolvedValue([{ email: "user@example.com" }])

    await sendNotificationEmail("user_escape", "<script>", "<b>bold</b>")

    const call = mockSendEmail.mock.calls[0]![0] as Record<string, unknown>
    const html = call.html as string
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;")
  })

  it("strips trailing slash from NEXT_PUBLIC_APP_URL before appending linkPath", async () => {
    mockLimit.mockResolvedValue([{ email: "user@example.com" }])

    // The mock env has "https://app.example.com" (no trailing slash)
    await sendNotificationEmail("user_url", "Link test", null, "/path/to/resource")

    const call = mockSendEmail.mock.calls[0]![0] as Record<string, unknown>
    const html = call.html as string
    // Must not double-slash the URL
    expect(html).not.toContain("//path")
    expect(html).toContain("https://app.example.com/path/to/resource")
  })
})
