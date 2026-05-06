import * as Sentry from "@sentry/nextjs"
import { env } from "@/lib/env"

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    // Edge runtime: lower sample rate (edge requests are usually short and
    // numerous) and avoid Node-only integrations.
    tracesSampleRate: env.NODE_ENV === "production" ? 0.05 : 0,
    environment: env.NODE_ENV,
    sendDefaultPii: false,
    integrations: [],
  })
}
