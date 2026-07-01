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
- `queries.ts` — live-connection reads + `decryptGrantId` (decrypt at point of use).
- `actions.ts` — `beginEmailConnect` / `disconnectEmail` (per-user; no owner gate).
- `nylas-inbound.ts` — verify + ingest a Nylas `message.created` webhook, reusing
  `email-log`'s `processInboundEmail` with the connection's source value.
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

## Forward-compat (designed, not built)

The same grant will later carry calendar + contacts scopes (separate future
builds). `scopes` records coverage; nullable `access_token`/`refresh_token`
columns exist so a future NATIVE Gmail/MS OAuth impl slots behind the same
EmailProvider interface without a schema refactor.

## Not purged / not truncate-listed

Like `telephony_connections`, this table is intentionally absent from
`purge-deleted` and `reset-db`'s truncate list — soft-deleted rows are kept for
audit and the table truncates via `TRUNCATE … CASCADE`.
