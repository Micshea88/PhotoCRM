---
name: add-cron
description: Use when the user asks for a scheduled job (daily reminders, hourly cleanup, weekly digest) — adds a Vercel Cron handler with secret auth and audit logging.
---

# Adding a cron job

## Steps

1. **Create the route handler:**
   `app/api/jobs/cron/<name>/route.ts`:

   ```ts
   import { db } from "@/lib/db"
   import { verifyCronAuth } from "@/modules/jobs/cron-auth"
   import { audit } from "@/modules/audit/audit"

   export async function GET(request: Request) {
     if (!verifyCronAuth(request)) {
       return new Response("Unauthorized", { status: 401 })
     }
     // Do the work. If it touches user data, scope it explicitly per organization
     // (cron has no session, but the audit row should still record the org).
     // Example pattern:
     //   for (const orgId of relevantOrgIds) {
     //     // ... do work for this org ...
     //     await audit({ db, organizationId: orgId, actorUserId: null }, "cron.<name>", { metadata: { ... } })
     //   }
     return Response.json({ ok: true, ts: new Date().toISOString() })
   }
   ```

2. **Register in `vercel.json`:**

   ```json
   {
     "crons": [{ "path": "/api/jobs/cron/<name>", "schedule": "0 6 * * *" }]
   }
   ```

   Schedule is a [cron expression](https://crontab.guru/). Default times are UTC.

3. **Auth.** Vercel automatically attaches `Authorization: Bearer ${CRON_SECRET}` when `CRON_SECRET` is set on the project. `verifyCronAuth()` is the only auth on cron routes.

4. **Audit.** Every cron run that mutates state writes one or more `audit_log` rows so you can see what ran when.

5. **Verify:**

   ```bash
   pnpm verify --tier=2
   ```

6. **Test locally** by hitting the endpoint with the bearer header:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/cron/<name>
   ```
