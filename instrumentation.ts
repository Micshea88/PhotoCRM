import { env } from "@/lib/env"

export async function register() {
  if (!env.SENTRY_DSN) return
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}
