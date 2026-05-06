# jobs module

Background work patterns: scheduled (cron) and async/fan-out (queue).

## Cron

Vercel reads `vercel.json` `crons` and hits the listed paths on schedule.
Vercel automatically adds an `Authorization: Bearer <CRON_SECRET>` header
when `CRON_SECRET` is set on the project; `verifyCronAuth()` enforces this.

Shipped crons:

- `app/api/jobs/cron/heartbeat/route.ts` — hourly health check.
- `app/api/jobs/cron/purge-deleted/route.ts` — daily 04:00 UTC. Hard-deletes
  rows that were soft-deleted more than 90 days ago, plus their blob storage.
  This is the **only** place hard deletes happen.

To add a new cron:

1. Create `app/api/jobs/cron/<name>/route.ts`.
2. Verify auth with `verifyCronAuth()` first.
3. Add an entry to `vercel.json` `crons`.

## Queue

Producer (`src/modules/jobs/queue.ts`) and consumer route handlers.
Defaults to a thin HTTP-fetch fallback so the pattern works locally without
a real queue platform attached. Swap the `enqueueExample()` body with a
Vercel Queues / Trigger.dev / Inngest publish call in production.

To add a new queue job:

1. Define the input schema in `src/modules/jobs/<name>.ts` (one file per job).
2. Export `enqueue<Name>(payload)` that fetches your consumer route.
3. Create `app/api/jobs/queue/<name>/route.ts` that:
   - Verifies `x-queue-secret` matches `QUEUE_SECRET`.
   - Parses the body with the Zod schema.
   - Does the work.
4. If using Vercel Queues, register the consumer URL in the dashboard.
