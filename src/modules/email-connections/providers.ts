/**
 * Email provider catalog (Commit 4 finish — Item 3). Single source of truth for
 * the connect picker, the Nylas hosted-auth `provider` param, whether SMTP
 * capture must be forced, and the `email_log.source` label.
 *
 * V1 offers ONLY: the two featured OAuth providers, a small row of recognizable
 * "Other" icons, and one generic IMAP catch-all ("All others"). A hardcoded
 * searchable list of additional named international providers is DEFERRED (Mike):
 * the catch-all already covers every provider, and the exact Nylas-named list
 * can't be verified from public docs — so it is intentionally not built here.
 *
 * Nothing here is invented — each `nylasProvider` value is one Nylas recognizes.
 * AOL rides Nylas's generic `imap` connector; the catch-all uses it too. Every
 * IMAP-based connection forces SMTP capture (options=smtp_required) so the grant
 * can SEND, not just receive.
 *
 * `kind`:
 *   - "oauth" → Google / Microsoft / Yahoo OAuth (no SMTP prompt needed).
 *   - "imap"  → IMAP-based; MUST force SMTP capture (options=smtp_required).
 *
 * `surface`:
 *   - "featured" → the two big buttons (Gmail, Microsoft).
 *   - "icon"     → the recognizable icon row revealed under "Other".
 *   - "catchall" → the final "All others — any other email server" option.
 */

export type EmailProviderKind = "oauth" | "imap"
export type EmailProviderSurface = "featured" | "icon" | "catchall"

export interface EmailProviderDef {
  /** Picker id + the value passed to beginEmailConnect. */
  id: string
  /** Human label shown in the UI. */
  label: string
  /** The Nylas hosted-auth `provider` query value. */
  nylasProvider: string
  /** email_log.source written for a connection to this provider. */
  sourceValue: string
  kind: EmailProviderKind
  surface: EmailProviderSurface
}

export const EMAIL_PROVIDERS: readonly EmailProviderDef[] = [
  // Featured OAuth
  {
    id: "gmail",
    label: "Gmail",
    nylasProvider: "google",
    sourceValue: "gmail",
    kind: "oauth",
    surface: "featured",
  },
  {
    id: "microsoft",
    label: "Microsoft",
    nylasProvider: "microsoft",
    sourceValue: "outlook",
    kind: "oauth",
    surface: "featured",
  },
  // Icon row under "Other"
  // Hotmail = personal outlook.com/hotmail/live → routes through the Microsoft
  // connector (NOT a separate connector), logged as "outlook".
  {
    id: "hotmail",
    label: "Hotmail",
    nylasProvider: "microsoft",
    sourceValue: "outlook",
    kind: "oauth",
    surface: "icon",
  },
  {
    id: "icloud",
    label: "iCloud",
    nylasProvider: "icloud",
    sourceValue: "icloud",
    kind: "imap",
    surface: "icon",
  },
  // Yahoo uses its OWN OAuth (Nylas-recommended over generic IMAP).
  {
    id: "yahoo",
    label: "Yahoo",
    nylasProvider: "yahoo",
    sourceValue: "yahoo",
    kind: "oauth",
    surface: "icon",
  },
  {
    id: "aol",
    label: "AOL",
    nylasProvider: "aol",
    sourceValue: "aol",
    kind: "imap",
    surface: "icon",
  },
  // Generic catch-all — any other email server via Nylas's generic IMAP
  // connector. Id kept as "other" for continuity with the Commit 4 card.
  {
    id: "other",
    label: "All others — any other email server",
    nylasProvider: "imap",
    sourceValue: "imap",
    kind: "imap",
    surface: "catchall",
  },
] as const

export const EMAIL_PROVIDER_IDS = EMAIL_PROVIDERS.map((p) => p.id)

export function getEmailProvider(id: string): EmailProviderDef | null {
  return EMAIL_PROVIDERS.find((p) => p.id === id) ?? null
}

export function emailProvidersBySurface(surface: EmailProviderSurface): EmailProviderDef[] {
  return EMAIL_PROVIDERS.filter((p) => p.surface === surface)
}
