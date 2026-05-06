import type { NextConfig } from "next"
import { withSentryConfig } from "@sentry/nextjs"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // typedRoutes intentionally off until all routes exist; re-enable in a later phase.
  typedRoutes: false,
  experimental: {
    // Tree-shake icon imports — without this, importing one icon from
    // lucide-react pulls the whole set into the client bundle.
    optimizePackageImports: ["lucide-react"],
  },
}

const hasSentry = Boolean(process.env.SENTRY_DSN)
const hasSentryUploadCreds = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
)

export default hasSentry
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Source-map upload — only attempted when build-time creds are present.
      // Without this, prod stack traces show minified file names like
      // chunks/page-abc123.js:1:8421 and are unreadable.
      sourcemaps: hasSentryUploadCreds
        ? {
            deleteSourcemapsAfterUpload: true,
          }
        : { disable: true },
      widenClientFileUpload: true,
      disableLogger: true,
    })
  : nextConfig
