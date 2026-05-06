import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "@/db/schema"

export type TestDb = NodePgDatabase<typeof schema>

export async function withTestDb<T>(fn: (db: TestDb) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for integration tests")
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const txDb = drizzle(client, { schema })
    try {
      return await fn(txDb)
    } finally {
      await client.query("ROLLBACK")
    }
  } finally {
    client.release()
    await pool.end()
  }
}
