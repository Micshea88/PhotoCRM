import "server-only"
import { env } from "@/lib/env"
import { log } from "@/lib/log"

/**
 * Cloudmersive Virus Scan (advanced) integration — Mike-locked 2026-06-24
 * (decision 15). Stateless: Cloudmersive scans in-memory and does not store
 * the file. We call the advanced endpoint with the unsafe-content flags OFF so
 * executables, scripts, macros, and password-protected archives all come back
 * as NOT clean (covers decision 23's password-protected-archive rejection
 * without us parsing zip bytes).
 *
 * Returns:
 *   - "clean"    → CleanResult true; file is attachable.
 *   - "infected" → CleanResult false (virus, executable, macro, or
 *                  password-protected/unscannable archive). Caller deletes the
 *                  Blob + shows the malware error.
 *   - "error"    → not configured, or the API failed after retries. Caller
 *                  leaves the file `pending` + shows "couldn't scan" error.
 */
export type ScanVerdict = "clean" | "infected" | "error"

const ENDPOINT = "https://api.cloudmersive.com/virus/scan/file/advanced"
const MAX_ATTEMPTS = 3

interface CloudmersiveAdvancedResult {
  CleanResult?: boolean
}

export async function scanFile(bytes: ArrayBuffer, filename: string): Promise<ScanVerdict> {
  if (!env.CLOUDMERSIVE_API_KEY) {
    log.warn("cloudmersive: CLOUDMERSIVE_API_KEY not set — scan skipped, file stays pending")
    return "error"
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const form = new FormData()
      form.append("inputFile", new Blob([bytes]), filename)
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Apikey: env.CLOUDMERSIVE_API_KEY,
          // Unsafe content → NOT clean. Password-protected archives can't be
          // verified, so they're rejected here (decision 23).
          allowExecutables: "false",
          allowInvalidFiles: "false",
          allowScripts: "false",
          allowPasswordProtectedFiles: "false",
          allowMacros: "false",
          allowXmlExternalEntities: "false",
          allowInsecureDeserialization: "false",
          allowHtml: "false",
        },
        body: form,
      })

      // 5xx / 429 are transient — retry. Other non-OK is a hard failure.
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`transient ${String(res.status)}`)
      }
      if (!res.ok) {
        log.error({ status: res.status }, "cloudmersive: non-retryable error response")
        return "error"
      }

      const data = (await res.json()) as CloudmersiveAdvancedResult
      return data.CleanResult === true ? "clean" : "infected"
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        log.error({ err }, "cloudmersive: scan failed after retries")
        return "error"
      }
      // Linear backoff between transient retries.
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
    }
  }
  return "error"
}
