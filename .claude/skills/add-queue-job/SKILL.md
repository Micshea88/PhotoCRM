---
name: add-queue-job
description: Use when the user wants async/fan-out work (send email batch, process webhook, trigger downstream side-effect) — adds a producer + consumer pair with shared-secret auth.
---

# Adding a queue job

## Steps

1. **Define the schema and producer** in `src/modules/jobs/<name>.ts`:

   ```ts
   import "server-only"
   import { z } from "zod"
   import { env } from "@/lib/env"

   export const <name>JobSchema = z.object({
     organizationId: z.string(),
     // ... your fields
   })
   export type <Name>Job = z.infer<typeof <name>JobSchema>

   export async function enqueue<Name>(job: <Name>Job) {
     <name>JobSchema.parse(job)
     const url = `${env.NEXT_PUBLIC_APP_URL}/api/jobs/queue/<name>`
     await fetch(url, {
       method: "POST",
       headers: {
         "content-type": "application/json",
         "x-queue-secret": env.QUEUE_SECRET,
       },
       body: JSON.stringify(job),
     })
   }
   ```

2. **Create the consumer route** at `app/api/jobs/queue/<name>/route.ts`:

   ```ts
   import { env } from "@/lib/env"
   import { <name>JobSchema } from "@/modules/jobs/<name>"

   export async function POST(request: Request) {
     const sig = request.headers.get("x-queue-secret") ?? ""
     if (sig !== env.QUEUE_SECRET) {
       return new Response("Unauthorized", { status: 401 })
     }
     const body = (await request.json()) as unknown
     const job = <name>JobSchema.parse(body)
     // Do the work.
     return Response.json({ ok: true })
   }
   ```

3. **Call the producer** from a server action or another job:

   ```ts
   import { enqueue<Name> } from "@/modules/jobs/<name>"
   await enqueue<Name>({ organizationId, /* ... */ })
   ```

4. **Verify:**
   ```bash
   pnpm verify --tier=2
   ```

## Notes

- The default transport is HTTP fire-and-forget. For real durability swap the producer body to a Vercel Queues / Trigger.dev / Inngest publish call.
- Idempotency: if the job is at-least-once-deliverable, design the consumer to be idempotent (check before insert, use unique constraints, etc.). The foundation does not ship an idempotency-key store.
