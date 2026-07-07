# email-connections

Per-photographer email connections (Commit 4). Each user connects their OWN
mailbox (Gmail / Outlook / other-IMAP) through **Nylas** hosted auth, so client
email sends **as them** and their replies log to the right contact.

Runs **alongside** the existing Resend paths — it does not replace them.

## What lives here

- `schema.ts` — `email_connections` table. Per-user, encrypted Nylas `grant_id`,
  org-isolation RLS, one live row per `(org, user, provider)`.
- `nylas-oauth.ts` — hosted-auth URL + code→grant exchange + provider→source map.
- `upsert.ts` — reactivate-or-insert the encrypted grant (telephony precedent).
- `queries.ts` — live-connection reads + `decryptGrantId` (decrypt at point of use);
  `isSendable`; `listExpiredConnectionsForUser`; `findConnectionByGrantIdAnyOrg`.
- `actions.ts` — `beginEmailConnect` / `disconnectEmail` (per-user; no owner gate).
- `nylas-inbound.ts` — verify + ingest Nylas webhooks (`message.created`,
  `message.bounce_detected`, `message.send_failed`, `grant.expired`, `thread.replied`).
- `providers.ts` — `EMAIL_PROVIDERS` catalog; `getEmailProvider`; `emailProvidersBySurface`.
- `types.ts` — connect input (gmail / microsoft / other).

The **EmailProvider abstraction** (`src/lib/email/provider.ts` + `nylas.ts`) is
where outbound routing decides Nylas-vs-dressed-Resend. System mail (auth /
invite / passcode) never routes here — it stays on `src/lib/email.ts:sendEmail`.

## Encryption

The Nylas `grant_id` is AES-256-GCM at rest via `src/lib/crypto.ts` keyed by
`NYLAS_ENCRYPTION_KEY` (its OWN security domain — not the telephony key). Nylas is
grant-based: there is no access/refresh token pair and no refresh loop; re-auth
is signalled by the `grant.expired` webhook (sets `status = "expired"`, which is
treated the same as never-connected for sending).

## Source taxonomy

`google → "gmail"`, `microsoft → "outlook"`, `other/IMAP → "imap"`. These are
`email_log.source` values; the partial-unique dedup index already keys on
`source`, so no dedup-index change was needed.

## Grant expiry (Task 8)

### Webhook trigger

Nylas sends a `grant.expired` event when the OAuth grant becomes invalid (token
revocation, password change, consent withdrawal). The handler in `nylas-inbound.ts`
→ `handleGrantExpired`:

1. Resolves the connection using `findConnectionByGrantIdAnyOrg` (see below).
2. Opens a transaction; sets `app.current_org` GUC.
3. Marks `status = "expired"`, stamps `expired_at` and `expired_reason`.
4. Emits an `email.disconnected` notification to the mailbox owner + org owners/admins
   (deduped). Body: "Your `{email}` connection stopped working. New emails are sending
   from your studio address until you reconnect."

### `isSendable(connection)` → `boolean`

```ts
export function isSendable(connection: EmailConnection | null): boolean
```

Returns true only when `connection !== null && connection.status === "connected"`.
An expired connection is treated the same as never-connected: `sendContactEmail`
falls back to the dressed Resend sender ("Name — Business" `<system>`).

### `findConnectionByGrantIdAnyOrg(db, grantId)` → grant resolution

Cross-org lookup used by webhook handlers (no session context). Two-step strategy:

1. **Hash lookup (O(1))** — `WHERE grant_id_hash = SHA-256(grantId) AND deleted_at IS NULL`.
   Fast path for all connections created after Task 8 (hash stored on connect).

2. **Decrypt-scan fallback** — scans live rows where `grant_id_hash IS NULL` (legacy
   rows created before Task 8). Decrypts each row's `grantId` and compares to the
   plaintext. On match, **opportunistically backfills `grant_id_hash`** so the fallback
   pool shrinks to zero as connections are touched — no manual migration needed.

`grantIdHash(grantId)` (also exported) computes the SHA-256 hex digest used by both
the write path (`upsert.ts`) and this lookup.

### Reconnect banner (`listExpiredConnectionsForUser`)

```ts
export async function listExpiredConnectionsForUser(db, orgId, userId): Promise<EmailConnection[]>
```

Returns all live expired connections for the given user in the org. Called by the
app-shell on every page load; runs cheap (indexed on `(org, user, deleted_at)`,
filtered to `status = "expired"`). Used to show the reconnect banner to the mailbox
owner. Admins do not see other users' expired connections from this query.

## Nylas inbound webhook (`nylas-inbound.ts`)

### `ingestNylasWebhook(rawBody, signature)` → rows written

Main dispatcher. Verifies `X-Nylas-Signature` (HMAC-SHA256 with `NYLAS_WEBHOOK_SECRET`)
and routes by `event.type`:

| Event type                | Handler                               | Behavior                                                                         |
| ------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `message.created`         | `ingestNylasInboundMessage`           | Fetch full message → `processInboundEmail` → `email.reply_received` notification |
| `message.bounce_detected` | `handleNylasDeliveryEvent("bounced")` | `recordDeliveryEvent` → `email.bounced` notification                             |
| `message.send_failed`     | `handleNylasDeliveryEvent("failed")`  | `recordDeliveryEvent` → `email.send_failed` notification                         |
| `grant.expired`           | `handleGrantExpired`                  | Mark expired + `email.disconnected` notification                                 |
| `thread.replied`          | no-op                                 | Reply notification fires via `message.created`; would double-notify              |
| anything else             | no-op                                 | Returns 0                                                                        |

### Field-name uncertainty (verify at connect time)

Nylas v3 payload shapes were coded defensively because they could not be verified offline:

- `event.id` — top-level event ID used as dedup key for delivery events (`providerEventId`). Uncertain field name.
- `data.object.message_id` vs `data.object.id` — handler tries `message_id` first, falls back to `id` (`extractNylasMessageId`).
- `data.object.bounce_type` vs `data.object.type` — `classifyBounceClass` handles both shapes plus the nested `detail.type` variant.
- `data.object.date` — Unix seconds; `extractOccurredAt` falls back to `new Date()` when absent.
- `data.object.grant_id` on `grant.expired` — required for `handleGrantExpired`.

**These must be verified against real payloads when the webhook is first connected.** See the connect+verify runbook in `docs/pending-integration-setup.md`.

## Provider catalog (`providers.ts`)

`EMAIL_PROVIDERS` — immutable array of `EmailProviderDef` entries:

```ts
interface EmailProviderDef {
  id: string // picker id + beginEmailConnect input
  label: string
  nylasProvider: string // Nylas hosted-auth ?provider= value
  sourceValue: string // email_log.source written for this connection
  kind: "oauth" | "imap"
  surface: "featured" | "icon" | "catchall"
}
```

Surfaces: `"featured"` (Gmail, Microsoft), `"icon"` (Hotmail, iCloud, Yahoo, AOL), `"catchall"` (all others — generic IMAP). IMAP-based connections force SMTP capture (`options=smtp_required`) so the grant can send.

`getEmailProvider(id)`, `emailProvidersBySurface(surface)` — lookup helpers.

## Forward-compat (designed, not built)

The same grant will later carry calendar + contacts scopes (separate future
builds). `scopes` records coverage; nullable `access_token`/`refresh_token`
columns exist so a future NATIVE Gmail/MS OAuth impl slots behind the same
EmailProvider interface without a schema refactor.

## Not purged / not truncate-listed

Like `telephony_connections`, this table is intentionally absent from
`purge-deleted` and `reset-db`'s truncate list — soft-deleted rows are kept for
audit and the table truncates via `TRUNCATE … CASCADE`.
