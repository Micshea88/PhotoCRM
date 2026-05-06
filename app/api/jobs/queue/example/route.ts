import { verifyQueueAuth } from "@/modules/jobs/cron-auth"
import { exampleJobSchema } from "@/modules/jobs/queue"
import { log } from "@/lib/log"

export async function POST(request: Request) {
  if (!verifyQueueAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  const body = (await request.json()) as unknown
  const job = exampleJobSchema.parse(body)

  // Real work goes here. For the example, log and return.
  log.info({ organizationId: job.organizationId, message: job.message }, "queue:example")

  return Response.json({ ok: true })
}
