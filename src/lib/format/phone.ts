/**
 * US phone helpers. Per LOC1 (US-only, no country selector) and the
 * P3 design system (docs/pathway-design-system.md → "Phone format
 * standard"):
 *
 *   - Display canonical form (everywhere — desktop, mobile, list,
 *     detail, modals, cards): "(555) 739-9897" — open paren, 3 digits,
 *     close paren, single space, 3 digits, hyphen (no surrounding
 *     spaces), 4 digits.
 *   - Storage: raw 10 digits ("5551234567"). No formatting, no leading
 *     "+1".
 *   - Edit input: any variant the user types (parens, dashes, dots,
 *     spaces, leading "+1"). InlineEditField's `normalizeOnSave` calls
 *     `parsePhoneInput` before invoking the action.
 *
 * `formatPhoneDisplay` is a pure formatter — pass in whatever the
 * column holds, get back a human-readable string. Tolerates any
 * input length; returns the value unchanged when it doesn't look
 * like a 10-digit US number (defensive against bad legacy rows).
 *
 * `parsePhoneInput` is the inverse — accepts user input in any
 * formatting variant and returns the 10 digits suitable for storage,
 * OR `null` if the input is empty / not 10 digits.
 */

export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return ""
  const digits = value.replace(/\D/g, "")
  // Allow leading 1 (e.g., "15551234567") by stripping it.
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (ten.length !== 10) return value
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

/**
 * Parse arbitrarily-formatted US phone input into the canonical
 * 10-digit storage form. Returns null if empty or not exactly 10
 * digits (after stripping a leading 1).
 */
export function parsePhoneInput(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/\D/g, "")
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  return ten.length === 10 ? ten : null
}
