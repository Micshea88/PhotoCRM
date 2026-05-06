import { config as loadEnv } from "dotenv"
import { defineConfig } from "drizzle-kit"

loadEnv({ path: ".env.local" })
loadEnv({ path: ".env" })

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error("DATABASE_URL is required for drizzle-kit. Set it in .env.local.")
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
