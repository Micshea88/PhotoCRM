import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { env } from "@/lib/env"
import * as schema from "@/db/schema"

// Guard: in development, refuse to start if DATABASE_URL is not localhost.
// This is the hard rule that Sage never accidentally connects to a production
// database from his local machine. Production credentials live only in Vercel
// project env vars.
if (env.NODE_ENV === "development") {
  const url = env.DATABASE_URL
  const isLocal =
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("postgres:5432") ||
    url.includes("@db:5432")
  if (!isLocal) {
    throw new Error(
      "[db] DATABASE_URL must point at a local Postgres in development. " +
        "Run `docker compose up -d` and set DATABASE_URL=postgres://postgres:postgres@localhost:5432/pathway_dev " +
        "in your .env.local. Production DATABASE_URL lives in Vercel only.",
    )
  }
}

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined
}

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  })

if (env.NODE_ENV !== "production") globalForDb.pool = pool

export const db = drizzle(pool, { schema })
export type Db = typeof db
