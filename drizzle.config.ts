import { config as loadEnv } from "dotenv"
import { defineConfig } from "drizzle-kit"

loadEnv({ path: ".env.local" })
loadEnv({ path: ".env" })

// drizzle-kit runs DDL. In local dev we connect as the docker superuser
// (DATABASE_URL_ADMIN) because the app's runtime URL is a non-privileged
// role that can't CREATE TABLE / ALTER POLICY. In production (Vercel build)
// only DATABASE_URL is set, against a Neon role that owns the schema — that
// role can do DDL too, so we fall back to DATABASE_URL there.
const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL
if (!url) {
  throw new Error("Set DATABASE_URL_ADMIN (preferred for local dev) or DATABASE_URL in .env.local.")
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
