import "server-only"
import pino from "pino"
import { env } from "@/lib/env"

/**
 * Structured logger for server-only code. Goes to stdout — Vercel collects it.
 *
 * `redact` masks common-PII paths so emails, password fields, tokens, and
 * auth headers don't leak into log drains. The list errs on the side of more
 * paths than fewer; if you log a new field that should be masked, add it here.
 */
export const log = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: { env: env.NODE_ENV },
  redact: {
    paths: [
      "password",
      "*.password",
      "*.passwordHash",
      "token",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.sessionToken",
      "secret",
      "*.secret",
      "authorization",
      "*.authorization",
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers.cookie",
      "cookie",
      "*.cookie",
    ],
    censor: "[redacted]",
  },
})
