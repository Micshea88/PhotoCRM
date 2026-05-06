import { describe, it, expect } from "vitest"
import { sql } from "drizzle-orm"
import { withTestDb } from "../helpers/db"

describe("db connectivity", () => {
  it("can run a trivial select", async () => {
    await withTestDb(async (db) => {
      const result = await db.execute<{ one: number }>(sql`select 1 as one`)
      expect(result.rows[0]?.one).toBe(1)
    })
  })
})
