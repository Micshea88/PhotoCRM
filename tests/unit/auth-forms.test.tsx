/**
 * Unit tests for the auth form error/loading contracts (auth UX fix).
 *
 * The production gap these guard: the forms had no try/catch/finally, so
 * a thrown rejection (network error, client throwing instead of returning
 * `{ error }`) left the submit button stuck on "Signing in…" / "Sending…"
 * forever with no message. Contract now:
 *   - Sign-in: credential failure → "Invalid email or password" (anti-
 *     enumeration); 5xx / thrown → generic; button always returns to
 *     normal; post-sign-in org-restore failure is non-fatal.
 *   - Forgot: always show the standard "if an account… exists" confirmation
 *     (even on a non-existent email / 4xx); only 5xx / thrown surface a
 *     generic error.
 *   - Reset: invalid/expired token → clear message; thrown → generic;
 *     button always returns to normal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  orgList: vi.fn(),
  getSession: vi.fn(),
  setActive: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  routerPush: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.routerPush, refresh: () => undefined }),
  useSearchParams: () => h.searchParams,
}))

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: h.signInEmail, social: h.signInSocial },
    organization: { list: h.orgList, setActive: h.setActive },
    getSession: h.getSession,
    requestPasswordReset: h.requestPasswordReset,
    resetPassword: h.resetPassword,
  },
}))

import { SignInForm } from "@/modules/auth/ui/sign-in-form"
import { ForgotPasswordForm } from "@/modules/auth/ui/forgot-password-form"
import { ResetPasswordForm } from "@/modules/auth/ui/reset-password-form"

beforeEach(() => {
  vi.clearAllMocks()
  h.searchParams = new URLSearchParams()
})

function typeInto(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe("SignInForm — error + loading contract", () => {
  it("a thrown rejection shows the generic error and resets the button", async () => {
    h.signInEmail.mockRejectedValue(new Error("network down"))
    render(<SignInForm />)
    typeInto(/email/i, "user@example.com")
    typeInto("Password", "secret")
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))

    expect(await screen.findByText("Something went wrong, please try again.")).toBeInTheDocument()
    // Button returned to its normal, enabled state — not a stuck spinner.
    const btn = screen.getByRole("button", { name: "Sign in" })
    expect(btn).not.toBeDisabled()
  })

  it("a credential failure shows the anti-enumeration message (not the raw error)", async () => {
    h.signInEmail.mockResolvedValue({ error: { status: 401, message: "User not found" } })
    render(<SignInForm />)
    typeInto(/email/i, "user@example.com")
    typeInto("Password", "secret")
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument()
    expect(screen.queryByText("User not found")).not.toBeInTheDocument()
  })

  it("a 5xx shows the generic error, not the credential message", async () => {
    h.signInEmail.mockResolvedValue({ error: { status: 500, message: "boom" } })
    render(<SignInForm />)
    typeInto(/email/i, "user@example.com")
    typeInto("Password", "secret")
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))

    expect(await screen.findByText("Something went wrong, please try again.")).toBeInTheDocument()
    expect(screen.queryByText("Invalid email or password")).not.toBeInTheDocument()
  })

  it("a post-sign-in org-restore failure is non-fatal (still redirects)", async () => {
    h.signInEmail.mockResolvedValue({ data: { user: {} } })
    h.orgList.mockRejectedValue(new Error("transient"))
    render(<SignInForm />)
    typeInto(/email/i, "user@example.com")
    typeInto("Password", "secret")
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))

    await waitFor(() => {
      expect(h.routerPush).toHaveBeenCalledWith("/dashboard")
    })
    expect(screen.queryByText("Something went wrong, please try again.")).not.toBeInTheDocument()
  })
})

describe("ForgotPasswordForm — anti-enumeration + error contract", () => {
  it("shows the standard confirmation on success", async () => {
    h.requestPasswordReset.mockResolvedValue({ data: {} })
    render(<ForgotPasswordForm />)
    typeInto(/email/i, "user@example.com")
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }))

    expect(
      await screen.findByText("If an account with that email exists, we've sent a reset link."),
    ).toBeInTheDocument()
  })

  it("shows the SAME confirmation on a 4xx (never reveals account existence)", async () => {
    h.requestPasswordReset.mockResolvedValue({ error: { status: 400, message: "no such user" } })
    render(<ForgotPasswordForm />)
    typeInto(/email/i, "user@example.com")
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }))

    expect(
      await screen.findByText("If an account with that email exists, we've sent a reset link."),
    ).toBeInTheDocument()
    expect(screen.queryByText("no such user")).not.toBeInTheDocument()
  })

  it("surfaces a real send failure (5xx) as a retryable error", async () => {
    h.requestPasswordReset.mockResolvedValue({ error: { status: 500, message: "resend down" } })
    render(<ForgotPasswordForm />)
    typeInto(/email/i, "user@example.com")
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }))

    expect(await screen.findByText("Something went wrong, please try again.")).toBeInTheDocument()
    const btn = screen.getByRole("button", { name: "Send reset link" })
    expect(btn).not.toBeDisabled()
  })

  it("a thrown rejection resets the button and shows the generic error", async () => {
    h.requestPasswordReset.mockRejectedValue(new Error("network down"))
    render(<ForgotPasswordForm />)
    typeInto(/email/i, "user@example.com")
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }))

    expect(await screen.findByText("Something went wrong, please try again.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send reset link" })).not.toBeDisabled()
  })
})

describe("ResetPasswordForm — token + error contract", () => {
  it("an invalid/expired token result shows a clear message and resets the button", async () => {
    h.searchParams = new URLSearchParams({ token: "tok-123" })
    h.resetPassword.mockResolvedValue({ error: { status: 400, message: "INVALID_TOKEN" } })
    render(<ResetPasswordForm />)
    typeInto(/new password/i, "Abcdefgh1!")
    typeInto(/confirm password/i, "Abcdefgh1!")
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }))

    expect(
      await screen.findByText("This reset link is invalid or has expired. Request a new one."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Set new password" })).not.toBeDisabled()
  })

  it("a thrown rejection shows the generic error and resets the button", async () => {
    h.searchParams = new URLSearchParams({ token: "tok-123" })
    h.resetPassword.mockRejectedValue(new Error("network down"))
    render(<ResetPasswordForm />)
    typeInto(/new password/i, "Abcdefgh1!")
    typeInto(/confirm password/i, "Abcdefgh1!")
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }))

    expect(await screen.findByText("Something went wrong, please try again.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Set new password" })).not.toBeDisabled()
  })

  it("redirects to /sign-in on success", async () => {
    h.searchParams = new URLSearchParams({ token: "tok-123" })
    h.resetPassword.mockResolvedValue({ data: {} })
    render(<ResetPasswordForm />)
    typeInto(/new password/i, "Abcdefgh1!")
    typeInto(/confirm password/i, "Abcdefgh1!")
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }))

    await waitFor(() => {
      expect(h.routerPush).toHaveBeenCalledWith("/sign-in")
    })
  })
})

describe("Google sign-in (optional alternate to email/password)", () => {
  it("shows 'Continue with Google' when enabled and starts Google sign-in on click", async () => {
    h.signInSocial.mockResolvedValue(undefined)
    render(<SignInForm googleEnabled />)

    const btn = screen.getByRole("button", { name: /continue with google/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)

    await waitFor(() => {
      expect(h.signInSocial).toHaveBeenCalledWith({ provider: "google", callbackURL: "/" })
    })
    // Email/password stays available — Google is additive, not a replacement.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
  })

  it("hides the Google button when it is not configured", () => {
    render(<SignInForm googleEnabled={false} />)
    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull()
    // Email/password still there.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
  })

  it("hides the Google button during the invite flow (a specific email is required)", () => {
    h.searchParams = new URLSearchParams({ email: "invited@example.com" })
    render(<SignInForm googleEnabled />)
    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull()
  })
})
