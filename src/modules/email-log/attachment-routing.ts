/**
 * Pure attachment-routing rules for the email composer (Mike-locked
 * 2026-06-24, decisions 16/18/19). No I/O — unit-tested directly.
 *
 *   - Max 10 files per email (decision 16).
 *   - 25 MB TOTAL per email — body + all attachments combined (decision 18,
 *     Gmail's send cap).
 *   - Over 25 MB → auto-fallback to "send as link" (decision 19): files go to
 *     Pathway Files, the email carries download links instead of attachments.
 */
export const MAX_FILES_PER_EMAIL = 10
export const DIRECT_ATTACH_LIMIT_BYTES = 25 * 1024 * 1024 // 25 MB

export type AttachmentMode = "attach" | "link"

export interface AttachmentRouting {
  /** "attach" = inline via Resend; "link" = upload + download links. */
  mode: AttachmentMode
  /** Combined body + attachment bytes. */
  totalBytes: number
  /** True when total exceeds the 25 MB direct-attach cap. */
  overLimit: boolean
}

/** Decide how to deliver attachments given each file's size + the body size. */
export function routeAttachments(fileSizes: number[], bodyBytes: number): AttachmentRouting {
  const totalBytes = fileSizes.reduce((sum, n) => sum + n, 0) + bodyBytes
  const overLimit = totalBytes > DIRECT_ATTACH_LIMIT_BYTES
  return { mode: overLimit ? "link" : "attach", totalBytes, overLimit }
}

/** Plain-English over-limit notice (rule #11, decision 19). */
export function sendAsLinkNotice(totalBytes: number): string {
  const mb = Math.ceil(totalBytes / (1024 * 1024))
  return `Your files total ${String(mb)} MB. Pathway will send these as download links — recipient clicks to download.`
}

export interface FileCountCheck {
  ok: boolean
  reason?: string
}

export function checkFileCount(count: number): FileCountCheck {
  if (count > MAX_FILES_PER_EMAIL) {
    return {
      ok: false,
      reason: `You can attach up to ${String(MAX_FILES_PER_EMAIL)} files per email.`,
    }
  }
  return { ok: true }
}
