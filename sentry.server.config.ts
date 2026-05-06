import * as Sentry from "@sentry/nextjs"
import { env } from "@/lib/env"

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 0,
    environment: env.NODE_ENV,
  })
}
