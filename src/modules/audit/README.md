# audit module

The receipt for everything that changes in the database.

## What it is

A single append-only `audit_log` table. Every state-changing action calls
`audit(ctx, "<resource>.<verb>", { resourceType, resourceId, metadata })`
to write a row. The schema lives in `schema.ts`; the helper in `audit.ts`.

## Hard rules

- **Audit is the receipt.** Don't add fields you don't intend to retain
  forever. Don't backfill or rewrite rows.
- **Don't render `metadata` raw in any UI.** It's user-supplied JSONB; treat
  it as untrusted and JSON-escape it on display.
- **No soft-delete here.** Audit rows are never deleted (the `purge-deleted`
  cron does NOT touch `audit_log`).
- **Don't query by `actorUserId` alone for security decisions.** Audit logs
  are descriptive, not authoritative — the source of truth for "what is X
  allowed to do" is the action layer, not the audit log.

## Adding new audit events

1. Inside an action handler:

   ```ts
   await audit(
     {
       db: ctx.db,
       organizationId: ctx.activeOrg.id,
       actorUserId: ctx.session.user.id,
       ipAddress: ctx.ipAddress,
       userAgent: ctx.userAgent,
     },
     "<resource>.<verb>",
     { resourceType: "<resource>", resourceId: id, metadata: { ... } },
   )
   ```

2. Convention: action name is past-tense singular-or-plural matching the
   table name (`items.created`, `files.uploaded`, `purge.items`). Keep verbs
   consistent across modules.

## Auth events

Auth events (`user.signed_in`, `user.password_reset`, etc.) are NOT yet
wired through `audit()`. See `TODO.md` H10.

## Retention

Indefinite by default. If a real retention policy is needed, add a separate
purge cron — do NOT extend `purge-deleted` to cover this table.
