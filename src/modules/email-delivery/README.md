# email-delivery

Unified delivery-event model for outbound email. Both send paths — Resend
(system/fallback sender) and Nylas (photographer's connected mailbox) — route
their delivery events through this module, which deduplicates, persists, updates
the denormalized status on `email_log`, and fires critical notifications.

## What lives here

```
modules/email-delivery/
├── schema.ts          # email_delivery_events table; RLS
├── ingest.ts          # recordDeliveryEvent / recordDeliveryEventInTx + pure helpers
├── classify-open.ts   # classifyOpen (human/bot/unknown); BOT_UA_PATTERNS; isAppleMppIp
└── resend-delivery.ts # ingestResendDeliveryEvent (Resend lane: bounced/complained/delivered)
```

## Schema

### `email_delivery_events`

Append-only log of delivery/bounce/open events.

| Column              | Notes                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                | cuid2 PK                                                                                        |
| `organization_id`   | org isolation (FORCE RLS)                                                                       |
| `email_log_id`      | FK → `email_log.id` (RESTRICT on deletion)                                                      |
| `path`              | `"resend"` or `"nylas"`                                                                         |
| `type`              | `"sent"` / `"delivered"` / `"bounced"` / `"failed"` / `"complained"` / `"opened"` / `"clicked"` |
| `bounce_class`      | `"hard"` / `"soft"` / null                                                                      |
| `detail`            | jsonb — raw provider payload / reason                                                           |
| `provider_event_id` | dedup key — Svix `svix-id` or Nylas event id; NULL for events with no provider id               |
| `occurred_at`       | provider-reported event timestamp                                                               |

**Dedup index**: `email_delivery_events_org_provider_event_uidx` on `(organization_id, provider_event_id) WHERE provider_event_id IS NOT NULL`. Idempotent redelivery — duplicate provider event IDs are silently ignored.

**RLS**: standard org-isolation policy. `FORCE ROW LEVEL SECURITY` hand-appended to migration.

## Ingest (`ingest.ts`)

### `recordDeliveryEvent(input)`

Public entry point for unauthenticated webhook contexts. Opens ONE transaction that:

1. Sets `app.current_org` GUC (satisfies FORCE RLS without a session).
2. Delegates to `recordDeliveryEventInTx`.

Returns `{ recorded: true }` when written; `{ recorded: false }` on a duplicate (idempotent redelivery — caller should ack 200 but skip downstream actions).

### `recordDeliveryEventInTx(tx, input)`

Core logic. Exported for callers that already hold a transaction (e.g. future machine-context callers).

**Precondition**: `app.current_org` must already be set on `tx`.

**Steps:**

1. **Idempotent insert** — `onConflictDoNothing` on the partial unique index. Returns `{ recorded: false }` when the row already exists (duplicate `provider_event_id`). For null `provider_event_id` the index doesn't apply, so every call inserts a new row.

2. **Status precedence update** — reads current `delivery_status` from `email_log`, computes `nextDeliveryStatus` (never downgrades), and updates the row. Additionally:
   - `bounced` → sets `bounced_at` + `bounce_reason` (regardless of status rank)
   - `failed` → sets `failed_at`

3. **Notification emit** (`emitNotificationInTx`) — for `bounced`, `complained`, and `failed` events, notifies the sender (`email_log.user_id`) + all org owners/admins (deduped). Maps event type to notification type:
   - `bounced` → `email.bounced` ("Email couldn't be delivered")
   - `complained` → `email.complained` ("Spam complaint")
   - `failed` → `email.send_failed` ("Email failed to send")

   `actorUserId: null` — bounces/failures are system events, NOT the user's own action, so own-action suppression in the dispatch engine does not apply. The sender is always notified.

### `DeliveryEventInput`

```ts
interface DeliveryEventInput {
  organizationId: string
  emailLogId: string // caller has already resolved a valid email_log row
  path: "nylas" | "resend"
  type: "sent" | "delivered" | "bounced" | "failed" | "complained"
  bounceClass?: "hard" | "soft" | null
  detail?: unknown // raw provider payload
  providerEventId?: string | null
  occurredAt: Date
}
```

### Pure helpers

**`deliveryStatusRank(status)`** — returns a numeric rank for status comparison: `sent=0, delivered=1, complained=2, failed=3, bounced=4`.

**`nextDeliveryStatus(current, eventType)`** — returns `eventType` when its rank exceeds the current status rank; returns `current` otherwise (never downgrades).

**`classifyBounceClass(detail)`** — best-effort bounce class from provider payloads. Handles:

- Resend: `{ bounceType: "hard"|"soft" }` or `{ type: "hard"|"soft"|"permanent"|"transient" }`
- Nylas: `{ detail: { type: ... } }` (recursive)
- Unknown → null

**`bounceReasonText(detail)`** — returns the first non-empty string from fields `reason`, `message`, `description`, `error`, `bounceMessage`; null when none found.

## Open classification (`classify-open.ts`)

Pure module — no DB, no I/O, no `Date.now()`. All inputs are passed in; safe for unit testing.

### `classifyOpen(input)` → `"human" | "bot" | "unknown"`

Applies rules in order (first match wins):

1. Missing/blank User-Agent → `"bot"` (headless fetchers rarely send UA)
2. UA contains a known bot/scanner pattern → `"bot"`
3. IP matches Apple MPP egress CIDR → `"unknown"` (MPP — ambiguous)
4. `msSinceSend < OPEN_BOT_TIMING_MS` → `"bot"` (pre-delivery security scanner)
5. Otherwise → `"human"`

### Constants

**`OPEN_BOT_TIMING_MS`** — 3000 ms. An open within 3 s of send is classified as bot. Tunable.

**`BOT_UA_PATTERNS`** — case-insensitive substring list including:
`googleimageproxy`, `ggpht`, `bot`, `crawler`, `spider`, `proofpoint`, `mimecast`, `barracuda`, `microsoft-outlook`, `claudebot`, `gptbot`, `bingpreview`, `feedfetcher`.

**`isAppleMppIp(ip)`** — tests an IPv4 address against `APPLE_MPP_CIDRS`. The current list is a **starter subset** covering Apple's `/8` allocation (`17.0.0.0/8`) plus well-known sub-ranges. The authoritative full list is published at `https://mask-api.icloud.com/egress-ip-ranges.csv`; fetching and caching that CSV at build/runtime is a documented follow-up task.

**`ipInCidr(ip, cidr)`** — exported IPv4 CIDR test (pure arithmetic, no net/os modules). Returns false for IPv6, malformed CIDR, and garbage input (never throws).

## Resend delivery lane (`resend-delivery.ts`)

### `ingestResendDeliveryEvent(event, providerEventId)`

Handles `email.bounced`, `email.complained`, and `email.delivered` events from the Resend webhook. Other event types are silently dropped.

1. Extracts `data.email_id` from the event.
2. Calls `findEmailLogByResendEmailIdAnyOrg` to correlate to an `email_log` row (cross-org, no GUC — expected to not match for mail sent before the Task 6 instrumentation was deployed).
3. Calls `recordDeliveryEvent` with the correct type + org.

`providerEventId` is the Svix `svix-id` header — serves as the dedup key.

## Nylas delivery lane

Handled in `src/modules/email-connections/nylas-inbound.ts`:

- `message.bounce_detected` → `recordDeliveryEvent({ type: "bounced" })`
- `message.send_failed` → `recordDeliveryEvent({ type: "failed" })`

Correlation is via `findEmailLogByNylasMessageIdAnyOrg` on the `external_metadata->>'nylasMessageId'` field stored when the outbound was logged.

## Invariants

- **Never downgrades**: a `bounced` email never reverts to `delivered`.
- **Idempotent**: duplicate `provider_event_id` is silently ignored; the status is not re-applied.
- **Notification fires only on first write**: `recordDeliveryEventInTx` checks `inserted.length` before emitting; duplicates do not re-notify.
- **Notification failure does NOT fail the write**: `emitNotificationInTx` errors would surface as exceptions inside the transaction, which would roll back the event insert. If notification failure must not block the write, wrap the emit in a try/catch (as `processInboundEmail` does for its notification call).
