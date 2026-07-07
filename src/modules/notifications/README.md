# notifications

In-app + email notification center (Tasks 9–16). Every event that warrants
alerting a user — email bounce, client reply, payment received, form completed,
etc. — is recorded here and optionally fanned out to the user's inbox.

## What lives here

```
modules/notifications/
├── schema.ts            # notifications + notification_preferences tables; RLS
├── types.ts             # NOTIFICATION_TYPES registry (21 types, 6 categories),
│                        # NEEDS_ACTION_TYPES, computeScheduledFor, getNotificationTypeMeta
├── settings-catalog.ts  # NOTIFICATION_SETTINGS_CATALOG (sections + rows), helpers
├── dispatch.ts          # emitNotification / emitNotificationInTx (the dispatch engine)
├── email.ts             # sendNotificationEmail + XSS helpers
├── queries.ts           # unreadCount, listNotifications, listArchivedNotifications,
│                        # getNotificationPreferences
├── actions.ts           # 7 orgActions (read/unread/archive/snooze/task/preference)
└── ui/
    ├── notification-bell.tsx          # Bell icon + red badge
    ├── notification-dropdown.tsx      # Popover panel (tabs, list, mark-all-read)
    ├── notification-filter-strip.tsx  # Type/contact/date filter chips
    ├── notification-row.tsx           # 3-layer row + hover actions
    ├── notification-settings-panel.tsx # /settings/notifications client panel
    ├── notifications-page-client.tsx  # /notifications full-page view
    └── group-by-date.ts               # Date-bucket grouping helper
```

## Schema

### `notifications`

One row per in-app notification. Key columns:

| Column                         | Notes                                                                    |
| ------------------------------ | ------------------------------------------------------------------------ |
| `id`                           | cuid2 PK                                                                 |
| `organization_id`              | org isolation                                                            |
| `recipient_user_id`            | which user sees this row                                                 |
| `type`                         | open-ended string — no CHECK constraint; must be in `NOTIFICATION_TYPES` |
| `category`                     | open-ended; conventional values from `NotificationCategory`              |
| `tier`                         | `"critical"` or `"routine"`                                              |
| `title` / `body` / `link_path` | display content                                                          |
| `contact_id`                   | nullable FK → contacts (SET NULL on deletion)                            |
| `payload`                      | jsonb; free-form extra context (emailLogId, threadId, etc.)              |
| `source_module`                | `"email"` today; extensible                                              |
| `read_at`                      | NULL = unread                                                            |
| `archived_at`                  | NULL = live                                                              |
| `snoozed_until`                | NULL or future date; expired snoozes auto-surface                        |
| `scheduled_for`                | NULL = deliver immediately; set for quiet-hours deferral                 |
| `email_sent_at`                | stamped when the fan-out email was sent                                  |

**RLS**: two permissive policies.

- `notifications_read_write` (FOR ALL): USING = `org + recipient_user_id`. Governs SELECT/UPDATE/DELETE and contributes a WITH CHECK for INSERT.
- `notifications_insert` (FOR INSERT): WITH CHECK = `org only`. This broadens INSERT so the dispatcher can create notifications for any recipient without holding a per-user session. The effective INSERT gate is the OR of both policies' WITH CHECKs → org-only.

`FORCE ROW LEVEL SECURITY` is hand-appended to the generated migration (drizzle-kit emits ENABLE but not FORCE — AGENTS.md rule 10a).

### `notification_preferences`

One row per (user, type) for users who override the registry default.

| Column                        | Notes                                         |
| ----------------------------- | --------------------------------------------- |
| `user_id` / `type`            | unique composite index                        |
| `in_app` / `email` / `mobile` | booleans; mobile persisted but UI is disabled |

Single permissive policy (FOR ALL) scoped to `org + user_id`.

## Type registry (`types.ts`)

`NOTIFICATION_TYPES` is the source-of-truth catalog. Each key maps to:

```ts
{
  category: NotificationCategory,
  tier: "critical" | "routine",
  label: string,
  defaultChannels: { in_app: boolean; email: boolean },
  needsAction: boolean,
}
```

**21 types across 6 categories:**

| Category (`messages_email`) | Tier     | needsAction                         |
| --------------------------- | -------- | ----------------------------------- |
| `email.bounced`             | critical | yes                                 |
| `email.complained`          | critical | yes                                 |
| `email.send_failed`         | critical | yes                                 |
| `email.reply_received`      | routine  | yes                                 |
| `email.clicked`             | routine  | no                                  |
| `email.opened`              | routine  | no — defaults OFF/OFF; log-only     |
| `sms.received`              | routine  | yes — non-firing until SMS is built |

| Category (`payments`) | Tier     | needsAction |
| --------------------- | -------- | ----------- |
| `payment.received`    | routine  | no          |
| `payment.failed`      | critical | yes         |

| Category (`documents`) | Tier    | needsAction |
| ---------------------- | ------- | ----------- |
| `proposal.viewed`      | routine | no          |
| `form.started`         | routine | no          |
| `form.completed`       | routine | yes         |
| `contract.signed`      | routine | no          |

| Category (`leads`)        | Tier    | needsAction |
| ------------------------- | ------- | ----------- |
| `lead.new_inquiry`        | routine | yes         |
| `lead.untouched_reminder` | routine | yes         |

| Category (`scheduling`) | Tier    | needsAction |
| ----------------------- | ------- | ----------- |
| `booking.made`          | routine | no          |
| `booking.cancelled`     | routine | yes         |
| `call.completed`        | routine | no          |
| `meeting.notes_ready`   | routine | no          |

| Category (`system`)  | Tier     | needsAction |
| -------------------- | -------- | ----------- |
| `email.disconnected` | critical | yes         |
| `account.security`   | critical | yes         |

The registry is open-ended: no database CHECK constraint enforces membership. Types not in `NOTIFICATION_TYPES` cause `getNotificationTypeMeta` to throw.

**`NEEDS_ACTION_TYPES`** — derived list of keys where `needsAction === true`. Used by the `needs_attention` preset and the bell badge count.

**`computeScheduledFor(settings, tier, now)`** — pure helper: returns the UTC Date of the next `quietHoursEnd` occurrence when a routine notification falls inside a configured quiet window; returns `null` (immediate delivery) for critical tier, no settings, or outside the window. Handles midnight-wrapping windows and DST correctly via `Intl`.

**`getNotificationTypeMeta(type)`** — throws for unknown type keys; returns the registry entry for known ones.

## Settings catalog (`settings-catalog.ts`)

`NOTIFICATION_SETTINGS_CATALOG` is a pure array of `SettingsSection[]` used by the settings UI:

```ts
interface SettingsRow {
  label: string
  types: readonly NotificationType[]
}
interface SettingsSection {
  key: NotificationCategory
  label: string
  rows: SettingsRow[]
}
```

A single row can govern **multiple types**. Example: "Email delivery problems" covers `["email.bounced", "email.complained", "email.send_failed"]` — the UI toggles all three together.

- **`defaultChannelsForRow(row)`** — OR across all types in the row; a channel is ON if ANY type defaults it ON.
- **`rowIsOn(prefsByType, row, channel)`** — returns true only when ALL types in the row are ON for that channel (either via stored pref or registry default). Toggling ON sets all to ON; toggling OFF sets all to OFF.

## Dispatch engine (`dispatch.ts`)

### `emitNotification(input)`

Entry point for **system/webhook/cron callers** (no existing transaction). Opens one DB transaction, sets `app.current_org` GUC, and delegates to `emitNotificationInTx`.

### `emitNotificationInTx(tx, input)`

Core per-recipient logic. Exported for callers that already hold a transaction (e.g. `recordDeliveryEventInTx` in `email-delivery`).

**Precondition**: `app.current_org` must already be set on `tx`.

Per-recipient steps:

1. **Registry lookup** — `getNotificationTypeMeta(input.type)` (throws on unknown).
2. **Own-action suppression** — skip if `recipientUserId === input.actorUserId`. Exception: bounces/failures/complaints use `actorUserId: null` so the sender is always notified even if they triggered the send.
3. **Preference resolution** — stored `notification_preferences` row wins over registry `defaultChannels`.
4. **Quiet-hours** — `computeScheduledFor`; deferred routines get `scheduled_for` set but no immediate email.
5. **In-app row insert** — when `in_app` channel is enabled.
6. **Email fan-out** — when `email` channel enabled AND (critical OR `scheduledFor === null`). Calls `sendNotificationEmail`; stamps `email_sent_at` on success. Deferred routines are flushed by the Task 17 cron.

### `EmitNotificationInput`

```ts
interface EmitNotificationInput {
  organizationId: string
  type: string // must be in NOTIFICATION_TYPES
  recipientUserIds: string[]
  actorUserId?: string | null
  contactId?: string | null
  title: string
  body?: string | null
  linkPath?: string | null
  payload?: Record<string, unknown> | null
  sourceModule: string
}
```

## Email sender (`email.ts`)

**`sendNotificationEmail(recipientUserId, title, body, linkPath?)`**

Looks up the user's email address from the `user` table, builds a minimal HTML email, and calls `sendEmail`. Returns `true` when dispatched, `false` when the user has no stored email address.

**XSS hardening:**

- `escapeHtml(str)` — escapes `&`, `<`, `>`, `"` before inserting user-controlled content into HTML.
- `isSafeLinkPath(path)` — allows only internal relative paths (must start with exactly one `/`, no `//`, no scheme pattern). Unsafe paths are dropped with a `log.warn`.

## Queries (`queries.ts`)

### `unreadCount(db, orgId, userId)`

Count of live, unread notifications. "Live" = `archived_at IS NULL AND (snoozed_until IS NULL OR snoozed_until ≤ now())`.

### `listNotifications(db, orgId, userId, filter?)`

Returns `NotificationWithContact[]` — notification columns plus `contactName` (trimmed `firstName + lastName` from a LEFT JOIN on contacts; null when no linked contact or contact deleted).

**Presets** (set via `filter.preset`):

- `"all"` (default) — all live rows
- `"unread"` — live rows where `read_at IS NULL`
- `"needs_attention"` — live + unread + `type ∈ NEEDS_ACTION_TYPES`

**Stacking filters** (AND with preset):

- `types` — list of type keys (OR within the list)
- `contactId` — only notifications linked to this contact
- `from` / `to` — `created_at` range (inclusive)
- `limit` (default 50) / `offset` (default 0)

Results ordered `created_at DESC`.

### `listArchivedNotifications(db, orgId, userId, opts?)`

Archived rows only (`archived_at IS NOT NULL`). Ordered `archived_at DESC`. Used by the Archive tab.

### `getNotificationPreferences(db, orgId, userId)`

All stored preference rows for the user (sparse — types not present fall back to registry defaults). Includes the `mobile` column.

## Actions (`actions.ts`)

All 7 are `orgAction` (auth + org enforced). All call `audit()` and `revalidatePath("/notifications")`.

| Action                         | Input                            | Behavior                                                                                                                                                               |
| ------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markNotificationRead`         | `{ id }`                         | Sets `read_at`; idempotent (no-op if already read)                                                                                                                     |
| `markNotificationUnread`       | `{ id }`                         | Clears `read_at`                                                                                                                                                       |
| `markAllNotificationsRead`     | `{}`                             | Marks all live unread rows as read                                                                                                                                     |
| `snoozeNotification`           | `{ id, until: Date }`            | Sets `snoozed_until`; must be in the future                                                                                                                            |
| `archiveNotification`          | `{ id }`                         | Sets `archived_at`                                                                                                                                                     |
| `createTaskFromNotification`   | `{ id }`                         | Inserts a task titled `"Follow up: <title>"` scoped to the notification's `contactId`. **Requires a contactId** — system notifications without one throw `VALIDATION`. |
| `updateNotificationPreference` | `{ type, inApp, email, mobile }` | Upserts a `notification_preferences` row (conflict on `userId, type`). Validates that `type ∈ NOTIFICATION_TYPES`.                                                     |

## UI

### Bell (`notification-bell.tsx`)

`<NotificationBell initialUnreadCount={n}>` — server-renders the initial count; refreshes after any action and on popover open. Badge caps display at "9+". Closes on click-outside or Escape.

### Dropdown (`notification-dropdown.tsx`)

`<NotificationDropdown>` — the 400px popover panel:

- **Header**: "Notifications" + "Mark all read" + gear link to `/settings/notifications`
- **Tabs**: All / Unread / Needs attention / Archive (switching clears filters)
- **Filter strip**: `<NotificationFilterStrip>` — type, contact, date-range chip filters
- **List**: date-grouped (`groupByDate`) rows of `<NotificationRow>` with hover actions; "You're all caught up" empty state; loading skeleton
- **Footer**: "See all notifications →" link to `/notifications`

Fetches from `/api/notifications?tab=…` on mount and on tab/filter change.

### Notification row (`notification-row.tsx`)

3-layer display: unread dot + title (layer 1), body (layer 2), contact name + relative time (layer 3). Hover actions: mark read/unread, snooze, archive, create task.

### `/notifications` page (`notifications-page-client.tsx`)

Full-page version of the notification center. Same tabs and filters as the dropdown but without size constraints.

### Settings panel (`notification-settings-panel.tsx`)

`<NotificationSettingsPanel prefs={...}>` at `/settings/notifications`. Renders `NOTIFICATION_SETTINGS_CATALOG` section by section. Each row has three toggles:

- **Bell** (`in_app`) — active
- **Email** — active
- **Mobile** — always disabled with tooltip "Mobile app coming soon"

Grouped rows toggle all constituent types together. Optimistic UI with rollback on server error. Calls `updateNotificationPreference` once per type per toggle.

## How to add a new notification type

1. **Add a registry entry** in `types.ts → NOTIFICATION_TYPES`:

   ```ts
   "your.event_name": {
     category: "messages_email",  // or whichever category fits
     tier: "routine",             // or "critical"
     label: "Human-readable label",
     defaultChannels: { in_app: true, email: true },
     needsAction: true,
   },
   ```

2. **Add a catalog row** in `settings-catalog.ts → NOTIFICATION_SETTINGS_CATALOG` under the matching section:

   ```ts
   { label: "Your event label", types: ["your.event_name"] },
   ```

   For grouped rows (multiple types, one toggle), list all types in the `types` array.

3. **Call `emitNotification` or `emitNotificationInTx`** from the module that produces the event:
   ```ts
   await emitNotification({
     organizationId,
     type: "your.event_name",
     recipientUserIds: [...],
     actorUserId: actingUser ?? null,
     contactId: contact.id ?? null,
     title: "...",
     body: "...",
     linkPath: "/contacts/...",
     sourceModule: "your-module",
   })
   ```

**Note:** a type with no emitter is valid — it's a live toggle with firing wired later. Examples: `sms.received` (SMS not yet built), `email.opened` (log-only; defaults OFF/OFF).
