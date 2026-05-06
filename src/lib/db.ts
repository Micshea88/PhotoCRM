import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { env } from "@/lib/env"
import * as schema from "@/db/schema"

/**
 * Hard rule: this app refuses to start in development unless DATABASE_URL
 * points at a local Postgres. Production credentials live ONLY in Vercel
 * project env vars; nobody should ever connect a laptop to the prod DB.
 *
 * The check parses the URL (rather than substring-matching) so that a host
 * name accidentally containing "localhost" doesn't bypass it.
 */
export function assertDatabaseIsLocal(url: string): void {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`[db] DATABASE_URL is not a valid URL: ${url}`)
  }
  const allowedLocalHosts = new Set(["localhost", "127.0.0.1", "::1", "db", "postgres"])
  if (!allowedLocalHosts.has(host)) {
    throw new Error(
      `[db] DATABASE_URL host "${host}" is not local. Run \`docker compose up -d\` and set ` +
        `DATABASE_URL=postgres://postgres:postgres@localhost:5432/pathway_dev in your .env.local. ` +
        `Production DATABASE_URL lives in Vercel only.`,
    )
  }
}

if (env.NODE_ENV === "development") {
  assertDatabaseIsLocal(env.DATABASE_URL)
}

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined
}

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Per-session timeouts: prevents a runaway query from holding a connection
    // (and any locks it took) indefinitely. 30s statement, 5s lock.
    options: "-c statement_timeout=30000 -c lock_timeout=5000",
  })

if (env.NODE_ENV !== "production") globalForDb.pool = pool

export const db = drizzle(pool, { schema })
export type Db = typeof db
