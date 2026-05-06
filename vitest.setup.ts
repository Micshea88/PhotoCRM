import "@testing-library/jest-dom/vitest"
import { config as loadEnv } from "dotenv"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

loadEnv({ path: ".env.test.local", override: false })
loadEnv({ path: ".env.local", override: false })
loadEnv({ path: ".env", override: false })

afterEach(() => {
  cleanup()
})
