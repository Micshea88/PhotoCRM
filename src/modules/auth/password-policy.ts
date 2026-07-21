import { z } from "zod"

/**
 * Password policy — the ONE source of truth for the client-side rules (AGENTS.md
 * backend policy #11): **min 8 + composition** (≥1 uppercase, ≥1 number, ≥1
 * special). Composition is deliberate competitor-parity (a conscious deviation
 * from NIST's length-only stance — see `docs/decisions-2026-07-16.md` →
 * Passwords, revised 2026-07-19).
 *
 * NOTE: HIBP breach screening is the *load-bearing* control in the policy and is
 * still TO WIRE (TODO H13). Server-side composition enforcement is likewise not
 * yet added — Better Auth enforces only `minPasswordLength: 8` today. This schema
 * fixes the form/policy drift (the sign-up/reset/account forms previously required
 * `min 12` with no composition); the server-side + HIBP hardening is tracked
 * separately in `docs/pre-events-punchlist.md`.
 */
export const PASSWORD_MIN = 8

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${String(PASSWORD_MIN)} characters`)
  .regex(/[A-Z]/, "Add at least one uppercase letter")
  .regex(/[0-9]/, "Add at least one number")
  .regex(/[^A-Za-z0-9]/, "Add at least one special character")

export const PASSWORD_REQUIREMENTS = [
  "At least 8 characters",
  "One uppercase letter",
  "One number",
  "One special character (e.g. ! ? @ #)",
] as const
