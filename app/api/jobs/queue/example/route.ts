import { env } from "@/lib/env"
import { exampleJobSchema } from "@/modules/jobs/queue"

export async function POST(request: Request) {
  const sig = request.headers.get("x-queue-secret") ?? ""
  if (sig !== env.QUEUE_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }
  const body = (await request.json()) as unknown
  const job = exampleJobSchema.parse(body)

  // Real work goes here. For the example, log and return.
  console.warn(`[queue:example] org=${job.organizationId} msg=${job.message}`)

  return Response.json({ ok: true })
}
