/**
 * Task 15F part 2 — Notification settings catalog.
 *
 * PURE — no DB, no server-only. Used by the settings UI (Task 16) to render
 * the full settings panel, section by section, in the correct order.
 *
 * A SettingsRow may govern multiple registry types (e.g. "Email delivery
 * problems" controls email.bounced + email.complained + email.send_failed
 * as a single toggle). The UI toggles all types in a row together.
 */

import type { NotificationCategory, NotificationType } from "./types"
import { NOTIFICATION_TYPES, NOTIFICATION_CATEGORY_LABELS } from "./types"

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SettingsRow {
  label: string
  types: readonly NotificationType[]
}

export interface SettingsSection {
  key: NotificationCategory
  label: string
  rows: SettingsRow[]
}

// ---------------------------------------------------------------------------
// Catalog — sections in the specified order
// ---------------------------------------------------------------------------

export const NOTIFICATION_SETTINGS_CATALOG: SettingsSection[] = [
  {
    key: "messages_email",
    label: NOTIFICATION_CATEGORY_LABELS.messages_email,
    rows: [
      {
        label: "Email delivery problems",
        types: ["email.bounced", "email.complained", "email.send_failed"],
      },
      { label: "Client replies", types: ["email.reply_received"] },
      { label: "Link clicked", types: ["email.clicked"] },
      { label: "Email opened", types: ["email.opened"] },
      { label: "Text received", types: ["sms.received"] },
    ],
  },
  {
    key: "payments",
    label: NOTIFICATION_CATEGORY_LABELS.payments,
    rows: [
      { label: "Payment received", types: ["payment.received"] },
      { label: "Payment failed", types: ["payment.failed"] },
    ],
  },
  {
    key: "documents",
    label: NOTIFICATION_CATEGORY_LABELS.documents,
    rows: [
      { label: "Proposal viewed", types: ["proposal.viewed"] },
      { label: "Form started", types: ["form.started"] },
      { label: "Form completed", types: ["form.completed"] },
      { label: "Contract signed", types: ["contract.signed"] },
    ],
  },
  {
    key: "leads",
    label: NOTIFICATION_CATEGORY_LABELS.leads,
    rows: [
      { label: "New inquiry", types: ["lead.new_inquiry"] },
      { label: "Untouched-lead reminder (2/5/7 days)", types: ["lead.untouched_reminder"] },
    ],
  },
  {
    key: "scheduling",
    label: NOTIFICATION_CATEGORY_LABELS.scheduling,
    rows: [
      { label: "Booking made", types: ["booking.made"] },
      { label: "Booking cancelled", types: ["booking.cancelled"] },
      { label: "Call completed", types: ["call.completed"] },
      { label: "Meeting notes ready", types: ["meeting.notes_ready"] },
    ],
  },
  {
    key: "system",
    label: NOTIFICATION_CATEGORY_LABELS.system,
    rows: [
      { label: "Email inbox disconnected", types: ["email.disconnected"] },
      { label: "Account & security", types: ["account.security"] },
    ],
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the merged default channels for a row.
 * Uses logical OR across all types in the row: a channel is ON if ANY of the
 * row's types defaults it ON. This means a grouped row's default is ON if any
 * underlying type defaults ON.
 */
export function defaultChannelsForRow(row: SettingsRow): { in_app: boolean; email: boolean } {
  let in_app = false
  let email = false
  for (const type of row.types) {
    const meta = NOTIFICATION_TYPES[type]
    if (meta.defaultChannels.in_app) in_app = true
    if (meta.defaultChannels.email) email = true
  }
  return { in_app, email }
}

/**
 * Returns whether a row is effectively ON for a given channel.
 *
 * A row is ON for a channel when ALL of its types are ON for that channel
 * (either via a stored preference or, when no pref is stored, the type's
 * registry default). The UI toggles all types in a row together, so the row
 * is only "fully on" when every constituent type is on.
 *
 * UI guidance:
 *   - Toggle ON:  set all row.types to true for that channel.
 *   - Toggle OFF: set all row.types to false for that channel.
 *   - Indeterminate state: rowIsOn returns false but not all are stored-false
 *     (e.g. partial override). The UI may render a mixed indicator.
 */
export function rowIsOn(
  prefsByType: Partial<Record<string, { in_app: boolean; email: boolean }>>,
  row: SettingsRow,
  channel: "in_app" | "email",
): boolean {
  return row.types.every((type) => {
    const pref = prefsByType[type]
    if (pref === undefined) {
      // No stored pref → fall back to the registry default
      return NOTIFICATION_TYPES[type].defaultChannels[channel]
    }
    return pref[channel]
  })
}
