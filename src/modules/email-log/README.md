# email-log

First-class home for all email activity — outbound (manually logged or sent via
the composer) and inbound (received via Resend or a photographer's Nylas-connected
mailbox). Replaces the old "Log email as a contact note" hack.

## What lives here

```
modules/email-log/
├── schema.ts              # email_log table; RLS; denormalized delivery + open columns
├── types.ts               # Zod input schemas (logEmailInput, updateEmailInput, deleteEmailInput)
├── queries.ts             # Cross-org resolvers (findEmailLogByResendEmailIdAnyOrg,
│                          # findEmailLogByNylasMessageIdAnyOrg)
├── inbound.ts             # processInboundEmail + ingestInboundFromEvent + buildBodyPreview
├── threading.ts           # parseMessageIdList, deriveThreadId, groupEmailsByThread
├── attachment-routing.ts  # Size-based direct-vs-link routing for the composer
├── actions.ts             # logEmail, updateEmail, deleteEmail, sendContactEmail (orgActions)
└── ui/
    ├── create-email-composer.tsx  # Compose + send modal
    └── email-thread-card.tsx      # Thread display in the activity feed
```

## Schema

### `email_log`

One row per logged email (one per participant for multi-party messages).

**Core columns:**

| Column                          | Notes                                                                      |
| ------------------------------- | -------------------------------------------------------------------------- |
| `id`                            | cuid2 PK                                                                   |
| `organization_id`               | org isolation (FORCE RLS)                                                  |
| `contact_id`                    | nullable FK → contacts (SET NULL on deletion)                              |
| `project_id` / `opportunity_id` | optional event/opportunity association                                     |
| `user_id`                       | who logged/sent the email (nullable; SET NULL on user deletion)            |
| `direction`                     | `"outbound"` or `"inbound"`                                                |
| `subject` / `body`              | email content                                                              |
| `sent_at`                       | when the email was sent/received (≠ `created_at`)                          |
| `source`                        | provider key — `"manual"`, `"resend"`, `"gmail"`, `"outlook"`, `"imap"`    |
| `external_id`                   | RFC-5322 Message-ID for provider rows; NULL for manual                     |
| `thread_id`                     | conversation grouping key (all messages in a thread share one)             |
| `external_metadata`             | jsonb — stores `resendEmailId` / `nylasMessageId` for cross-org resolution |
| `attachments`                   | jsonb array of `{ fileId, name, size, deliveryMethod?, shareLinkToken? }`  |
| `tracking_pixel_id`             | unique per outbound email; NULL for inbound + untracked                    |

**Denormalized delivery columns** (written by `email-delivery/ingest.ts`):

| Column                         | Notes                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `delivery_status`              | `"sent"` (default) → `"delivered"` → `"bounced"` / `"failed"` / `"complained"` |
| `bounced_at` / `bounce_reason` | set on first bounce event                                                      |
| `failed_at`                    | set on first failure event                                                     |

**Denormalized open-classification columns** (written by `email-delivery` open events):

| Column                               | Notes                                     |
| ------------------------------------ | ----------------------------------------- |
| `open_count`                         | total opens                               |
| `open_human_count`                   | opens classified as human                 |
| `open_bot_count`                     | opens classified as bot/scanner           |
| `open_unknown_count`                 | opens classified as Apple MPP / ambiguous |
| `first_opened_at` / `last_opened_at` | timestamps                                |

**Dedup index**: `email_log_org_source_external_uidx` on `(organization_id, source, external_id) WHERE external_id IS NOT NULL`. Prevents duplicate webhook redeliveries. Manual rows (NULL `external_id`) bypass it.

**RLS**: single permissive policy — `organization_id = app.current_org`. `FORCE ROW LEVEL SECURITY` hand-appended to migration.

## Inbound pipeline (`inbound.ts`)

### `processInboundEmail(email, source?, opts?)`

The canonical entry point for both Resend and Nylas inbound email. Called with:

- `email: InboundEmail` — parsed message (from, to, cc, subject, body, messageId, inReplyTo, references, sentAt)
- `source` — provider taxonomy: `"resend"` (default) or `"gmail"` / `"outlook"` / `"imap"` for Nylas-connected mailboxes
- `opts.recipientUserIds` — Nylas lane supplies the mailbox owner explicitly; Resend lane omits this and falls back to a query of org owners + admins via `memberRole`

**Steps:**

1. **Contact match** — resolves `email.from` to a known contact across all orgs (case-insensitive, most-recently-updated on multi-match). Unknown senders are **dropped** — no log, no auto-create (Mike-locked: "log replies only").

2. **Dedup** — skips if this `(orgId, source, messageId)` is already in `email_log`. The partial unique index is a backstop.

3. **Threading** — parses `In-Reply-To` + `References` headers via `parseMessageIdList`, looks up any known `threadId` in `email_log` for the referenced Message-IDs. Inherits that thread or starts a new one rooted at the message's own ID (`deriveThreadId`).

4. **Participant logging** — inserts one row for the sender (with the dedup `external_id`) and one for each known To/CC contact within the org (no `external_id` — allowed by the partial unique index). Bcc is never logged.

5. **Notification emit** — fires `email.reply_received` when ALL of:
   - A new row was inserted (dedup-safe)
   - `inReplyTo !== null` OR `inheritedThreadId !== null` (it's an actual reply, not a cold inbound)

   Notification recipients: `opts.recipientUserIds` (Nylas lane) or org owners + admins (Resend lane). Failure to emit does NOT fail the ingest.

### `ingestInboundFromEvent(event)` / `ingestInboundEmail(rawBody, headers)`

Resend webhook entry points. `ingestInboundFromEvent` handles `email.received` events (fetches the full message from Resend's Received-Emails API then calls `processInboundEmail`). Other event types are no-ops.

### `buildBodyPreview(body, maxLen?)`

Strips HTML tags and quoted-reply lines (`>` prefix), collapses whitespace, truncates to `maxLen` (default 140). Used for notification body previews. Exported for unit testing.

## Threading (`threading.ts`)

- **`parseMessageIdList(header)`** — extracts RFC-5322 `<...>` tokens from In-Reply-To / References strings.
- **`deriveThreadId(selfMessageId, inheritedThreadId)`** — returns the inherited thread ID when available, else uses `selfMessageId` as the thread root.
- **`groupEmailsByThread<T>(emails)`** — groups a list of email objects by `threadId`, sorts within thread oldest→newest, sorts groups most-recently-active first.

## Queries (`queries.ts`)

### Cross-org resolvers

These run without an org GUC set and are used by webhook handlers that receive events with no session context.

**`findEmailLogByResendEmailIdAnyOrg(db, resendEmailId)`**
Finds the most-recent `email_log` row whose `external_metadata->>'resendEmailId'` matches. Used by the Resend delivery webhook to correlate bounce/complaint/delivered events to a logged outbound email.

**`findEmailLogByNylasMessageIdAnyOrg(db, nylasMessageId)`**
Same pattern — matches `external_metadata->>'nylasMessageId'`. Used by the Nylas delivery webhook for bounce/send_failed correlation.

Both queries use a plain `db.select()`. In production the base pool role has `BYPASSRLS` so FORCE RLS does not apply and the queries return across all orgs. In development the app role (`pathway_app`) has `NOBYPASSRLS` — callers in dev that need the result must set the org GUC externally.

## Actions (`actions.ts`)

All are `orgAction` (auth + org enforced).

| Action             | Behavior                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logEmail`         | Manual log — inserts a `source="manual"` row; invalidates AI cache; audits                                                                                                                                                                               |
| `updateEmail`      | Patch subject/body/direction/dates/associations; audits                                                                                                                                                                                                  |
| `deleteEmail`      | Soft-delete (`deletedAt`); audits                                                                                                                                                                                                                        |
| `sendContactEmail` | Compose + send via the photographer's connected mailbox (Nylas) or dressed Resend fallback. Handles direct attachment (≤25 MB total) vs. send-as-link routing, passcode-protected share links, tracking pixel injection, and CC contact logging. Audits. |

### Attachment routing (`attachment-routing.ts`)

`routeAttachments(fileSizeBytes[], bodyBytes)` — returns `{ mode: "direct" | "link" }`. Total > 25 MB → all files send as links. Otherwise direct.

## Activity feed integration

`email_log` rows appear in the contact activity feed alongside call logs, notes, and tasks. The `direction` column drives the left/right orientation. The `tracking_pixel_id` column links to the `/api/email/track/[id].png` route for open tracking.

## Soft delete

`email_log` has `deleted_at` / `deleted_by` columns. `deleteEmail` sets them; queries filter `deleted_at IS NULL`. Listed in `purge-deleted` and `reset-db` truncate lists.
