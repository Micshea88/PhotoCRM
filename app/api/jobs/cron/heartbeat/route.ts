import { sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { verifyCronAuth } from "@/modules/jobs/cron-auth"

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return new Response("Unauthorized", { status: 401 })
  }
  await db.execute(sql`select 1`)
  return Response.json({ ok: true, ts: new Date().toISOString() })
}
