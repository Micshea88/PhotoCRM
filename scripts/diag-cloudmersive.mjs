/**
 * [SCAN-DIAG] Standalone Cloudmersive latency probe (2026-06-26).
 *
 * Measures the PURE Cloudmersive advanced-scan API round-trip in isolation —
 * no Vercel Blob download, no DB, no client polling — so we can tell whether a
 * slow scan is the API itself vs. our pipeline.
 *
 * Usage:
 *   CLOUDMERSIVE_API_KEY=xxxx node scripts/diag-cloudmersive.mjs <file> [runs]
 *
 * Example (the 483 KB PDF, 5 sequential runs to show variance/queueing):
 *   CLOUDMERSIVE_API_KEY=xxxx node scripts/diag-cloudmersive.mjs ~/Desktop/test.pdf 5
 *
 * Prints, per run: HTTP status, API duration (ms), and the FULL JSON payload.
 * Then a summary (min / max / mean). Sequential runs surface free/Basic-tier
 * rate-limit queueing that a single run would hide.
 */
import { readFile } from "node:fs/promises"

const ENDPOINT = "https://api.cloudmersive.com/virus/scan/file/advanced"
const HEADERS = {
  allowExecutables: "false",
  allowInvalidFiles: "false",
  allowScripts: "false",
  allowPasswordProtectedFiles: "false",
  allowMacros: "false",
  allowXmlExternalEntities: "false",
  allowInsecureDeserialization: "false",
  allowHtml: "false",
}

const apiKey = process.env.CLOUDMERSIVE_API_KEY
const filePath = process.argv[2]
const runs = Number(process.argv[3] ?? "3")

if (!apiKey) {
  console.error("✘ Set CLOUDMERSIVE_API_KEY (it lives in Vercel; pull it locally to run this).")
  process.exit(1)
}
if (!filePath) {
  console.error("✘ Usage: node scripts/diag-cloudmersive.mjs <file> [runs]")
  process.exit(1)
}

const bytes = await readFile(filePath)
const sizeKb = (bytes.byteLength / 1024).toFixed(1)
const filename = filePath.split("/").pop() ?? "upload"
console.log(`\n[SCAN-DIAG] file=${filename} size=${sizeKb} KB runs=${String(runs)}\n`)

const durations = []
for (let i = 1; i <= runs; i++) {
  const form = new FormData()
  form.append("inputFile", new Blob([bytes]), filename)
  const start = Date.now()
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Apikey: apiKey, ...HEADERS },
      body: form,
    })
    const ms = Date.now() - start
    durations.push(ms)
    const text = await res.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text.slice(0, 300)
    }
    console.log(`run ${String(i)}: status=${String(res.status)} apiMs=${String(ms)}`)
    console.log(`         payload=${JSON.stringify(payload)}`)
  } catch (err) {
    const ms = Date.now() - start
    console.log(`run ${String(i)}: ERROR after ${String(ms)}ms — ${err instanceof Error ? err.message : String(err)}`)
  }
}

if (durations.length > 0) {
  const min = Math.min(...durations)
  const max = Math.max(...durations)
  const mean = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  console.log(`\n[SCAN-DIAG] summary: min=${String(min)}ms mean=${String(mean)}ms max=${String(max)}ms\n`)
}
