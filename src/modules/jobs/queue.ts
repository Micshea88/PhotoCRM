import "server-only"
import { z } from "zod"
import { env } from "@/lib/env"

/**
 * The foundation ships a thin queue facade that supports two transports:
 *
 *   - "vercel" — posts to the Vercel Queues API (assumes JOB_TRANSPORT=vercel,
 *     and that you've configured a Vercel Queue and given it the consumer URL).
 *   - "http"   — posts directly to the consumer route via fetch (default).
 *     Useful for local development and as a fallback if Vercel Queues isn't
 *     available in the deployment region.
 *
 * Replace this file when you adopt a real queue platform (Trigger.dev, Inngest,
 * a Postgres-backed jobs table). The contract is: producer enqueues a job; the
 * matching consumer route handler gets called with the same JSON payload and
 * a shared secret header.
 */

export const exampleJobSchema = z.object({
  organizationId: z.string(),
  message: z.string(),
})
export type ExampleJob = z.infer<typeof exampleJobSchema>

export async function enqueueExample(job: ExampleJob) {
  exampleJobSchema.parse(job)
  // For now, fire-and-forget HTTP fetch to the consumer route. In production
  // you'd swap this for a Vercel Queues publish call.
  const url = `${env.NEXT_PUBLIC_APP_URL}/api/jobs/queue/example`
  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-queue-secret": env.QUEUE_SECRET,
    },
    body: JSON.stringify(job),
  })
}
