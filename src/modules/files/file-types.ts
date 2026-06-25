/**
 * Allowed / blocked file types for uploads + email attachments (Mike-locked
 * 2026-06-24, decisions 22–23). Pure — no I/O — so it runs at the upload
 * endpoint (fail fast, before the malware scan) and unit-tests directly.
 *
 * Validation is by file EXTENSION: photography RAW + design formats have
 * inconsistent/absent MIME types, so the extension is the reliable signal.
 * Blacklist wins over whitelist. Password-protected archives are rejected by
 * the Cloudmersive scan (allowPasswordProtectedFiles=false), not here.
 */
export const ALLOWED_EXTENSIONS = new Set<string>([
  // Documents
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "pptx",
  "ppt",
  "txt",
  "csv",
  "rtf",
  "pages",
  "numbers",
  "key",
  // Images
  "jpeg",
  "jpg",
  "png",
  "gif",
  "webp",
  "svg",
  "heic",
  "tiff",
  // Photography RAW
  "cr2",
  "cr3",
  "nef",
  "arw",
  "dng",
  "orf",
  "raf",
  // Photoshop / design
  "psd",
  "ai",
  // Video
  "mp4",
  "mov",
  "webm",
  // Audio
  "mp3",
  "wav",
  // Archives (scanner verifies contents)
  "zip",
])

/** Always blocked, even if an extension somehow also appears elsewhere. */
export const BLOCKED_EXTENSIONS = new Set<string>([
  "exe",
  "dll",
  "bat",
  "cmd",
  "com",
  "vbs",
  "js",
  "scr",
  "app",
  "jar",
  "msi",
  "ps1",
  "sh",
])

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".")
  return dot >= 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : ""
}

export interface FileTypeCheck {
  ok: boolean
  /** Plain-English reason when blocked (rule #11). */
  reason?: string
  /** True for HEIC — the UI shows a "may not display in all email clients" notice. */
  heicNotice?: boolean
}

export function checkFileType(filename: string): FileTypeCheck {
  const ext = fileExtension(filename)
  if (!ext) return { ok: false, reason: "This file type isn't supported." }
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "This file type isn't allowed for security reasons." }
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) return { ok: false, reason: "This file type isn't supported." }
  if (ext === "heic") return { ok: true, heicNotice: true }
  return { ok: true }
}
