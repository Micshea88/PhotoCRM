import "server-only"
import { z } from "zod"
import { env } from "@/lib/env"
import { log } from "@/lib/log"

/**
 * ⚠️  STUB IMPLEMENTATION — NOT DURABLE.
 *
 * `enqueueExample` performs a fire-and-await HTTP fetch to the consumer route.
 * If the consumer 5xx's or the producer's invocation freezes mid-call, the
 * job is LOST. There is no retry, no dead-letter, no scheduling, no fan-out.
 *
 * This is intentional scaffolding so the routing/auth pattern is in place,
 * but DO NOT use it for anything that must not be lost (webhook delivery,
 * billing events, downstream side-effects). Before that, swap in one of:
 *
 *   - Vercel Queues (the official path on Vercel)
 *   - Inngest / Trigger.dev (managed durable execution)
 *   - A `jobs` table in Postgres + a cron consumer (DIY outbox pattern)
 *
 * The producer (this file) and the consumer route (`app/api/jobs/queue/...`)
 * are the swap-points. Schemas, auth, and the verify-shared-secret pattern
 * stay the same regardless of transport.
 */

export const exampleJobSchema = z.object({
  organizationId: z.string(),
  message: z.string(),
})
export type ExampleJob = z.infer<typeof exampleJobSchema>

export async function enqueueExample(job: ExampleJob): Promise<void> {
  exampleJobSchema.parse(job)
  if (env.NODE_ENV === "production") {
    log.warn(
      { job: "example" },
      "[queue] STUB enqueue — not durable. Replace with a real queue before relying on this.",
    )
  }
  const url = `${env.NEXT_PUBLIC_APP_URL}/api/jobs/queue/example`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-queue-secret": env.QUEUE_SECRET,
    },
    body: JSON.stringify(job),
  })
  if (!res.ok) {
    throw new Error(`[queue] consumer returned ${String(res.status)} — job lost`)
  }
}
