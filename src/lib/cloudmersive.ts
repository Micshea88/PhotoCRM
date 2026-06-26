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

  // [SCAN-DIAG] Temporary instrumentation (2026-06-26) to diagnose slow scans.
  // Captures per-attempt API round-trip duration + the raw response payload so
  // we can tell whether the latency is the Cloudmersive API itself vs. our
  // pipeline (blob download / polling). Grep Vercel logs for "[SCAN-DIAG]".
  const sizeBytes = bytes.byteLength
  const scanStart = Date.now()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStart = Date.now()
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
      const apiMs = Date.now() - attemptStart

      // 5xx / 429 are transient — retry. Other non-OK is a hard failure.
      if (res.status >= 500 || res.status === 429) {
        log.warn(
          { filename, sizeBytes, attempt, status: res.status, apiMs },
          "[SCAN-DIAG] cloudmersive transient response — will retry",
        )
        throw new Error(`transient ${String(res.status)}`)
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => "<unreadable>")
        log.error(
          { filename, sizeBytes, attempt, status: res.status, apiMs, errBody },
          "[SCAN-DIAG] cloudmersive: non-retryable error response",
        )
        return "error"
      }

      // Read raw text first so we can log the FULL payload (CleanResult plus any
      // FoundViruses / WeaponType / Contains*-flags Cloudmersive returns).
      const rawBody = await res.text()
      let data: CloudmersiveAdvancedResult = {}
      try {
        data = JSON.parse(rawBody) as CloudmersiveAdvancedResult
      } catch {
        log.error(
          { filename, sizeBytes, attempt, apiMs, rawBody: rawBody.slice(0, 500) },
          "[SCAN-DIAG] cloudmersive: response was not JSON",
        )
        return "error"
      }
      const verdict: ScanVerdict = data.CleanResult === true ? "clean" : "infected"
      log.info(
        {
          filename,
          sizeBytes,
          attempt,
          status: res.status,
          apiMs,
          totalMs: Date.now() - scanStart,
          verdict,
          payload: data,
        },
        "[SCAN-DIAG] cloudmersive scan complete",
      )
      return verdict
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        log.error(
          { err, filename, sizeBytes, attempt, totalMs: Date.now() - scanStart },
          "[SCAN-DIAG] cloudmersive: scan failed after retries",
        )
        return "error"
      }
      // Linear backoff between transient retries.
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
    }
  }
  return "error"
}
