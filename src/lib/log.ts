import "server-only"
import pino from "pino"
import { env } from "@/lib/env"

export const log = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: { env: env.NODE_ENV },
})
