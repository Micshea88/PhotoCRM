import type { NextConfig } from "next"
import { withSentryConfig } from "@sentry/nextjs"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // typedRoutes intentionally off until all routes exist; re-enable in a later phase.
  typedRoutes: false,
}

const hasSentry = Boolean(process.env.SENTRY_DSN)

export default hasSentry
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disableLogger: true,
    })
  : nextConfig
