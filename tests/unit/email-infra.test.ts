/**
 * Unit tests for the pure email-infrastructure helpers (Commit 3):
 * file-type whitelist/blacklist, attachment routing (25 MB / send-as-link /
 * max-files), threading (parse, derive, group).
 */
import { describe, it, expect } from "vitest"
import { checkFileType, fileExtension } from "@/modules/files/file-types"
import {
  routeAttachments,
  checkFileCount,
  checkFileSize,
  sendAsLinkNotice,
  DIRECT_ATTACH_LIMIT_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_EMAIL,
} from "@/modules/email-log/attachment-routing"
import {
  parseMessageIdList,
  deriveThreadId,
  groupEmailsByThread,
} from "@/modules/email-log/threading"

describe("file-type validation", () => {
  it("allows whitelisted documents/images/RAW/design/zip", () => {
    for (const f of ["a.pdf", "b.DOCX", "c.cr3", "d.psd", "e.zip", "f.mp4", "g.heic"]) {
      expect(checkFileType(f).ok).toBe(true)
    }
  })
  it("flags HEIC with a display notice", () => {
    expect(checkFileType("photo.heic")).toEqual({ ok: true, heicNotice: true })
  })
  it("blocks executables (blacklist wins)", () => {
    for (const f of ["x.exe", "y.bat", "z.app", "m.msi", "s.sh", "j.jar"]) {
      const r = checkFileType(f)
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/security/)
    }
  })
  it("rejects unknown extensions + extensionless names", () => {
    expect(checkFileType("weird.xyz").ok).toBe(false)
    expect(checkFileType("noext").ok).toBe(false)
  })
  it("error messages name the offending extension (clearer matrix)", () => {
    expect(checkFileType("malware.exe").reason).toContain(".exe")
    expect(checkFileType("weird.xyz").reason).toContain(".xyz")
  })
  it("fileExtension lowercases + handles dotfiles", () => {
    expect(fileExtension("Report.PDF")).toBe("pdf")
    expect(fileExtension("archive.tar.gz")).toBe("gz")
    expect(fileExtension("README")).toBe("")
  })
})

describe("attachment routing", () => {
  const MB = 1024 * 1024
  it("attaches inline under 25 MB total", () => {
    const r = routeAttachments([5 * MB, 5 * MB], 1024)
    expect(r.mode).toBe("attach")
    expect(r.overLimit).toBe(false)
  })
  it("falls back to link over 25 MB (body + files combined)", () => {
    const r = routeAttachments([20 * MB, 6 * MB], 0)
    expect(r.mode).toBe("link")
    expect(r.overLimit).toBe(true)
    expect(r.totalBytes).toBe(26 * MB)
  })
  it("exactly 25 MB stays inline (cap is exclusive)", () => {
    expect(routeAttachments([DIRECT_ATTACH_LIMIT_BYTES], 0).mode).toBe("attach")
  })
  it("enforces the 10-file ceiling", () => {
    expect(checkFileCount(MAX_FILES_PER_EMAIL).ok).toBe(true)
    expect(checkFileCount(MAX_FILES_PER_EMAIL + 1).ok).toBe(false)
  })
  it("checkFileSize: allows ≤ 1 GB, rejects over with a sized message", () => {
    expect(checkFileSize(500 * 1024).ok).toBe(true)
    expect(checkFileSize(MAX_FILE_BYTES).ok).toBe(true)
    const over = checkFileSize(MAX_FILE_BYTES + 1)
    expect(over.ok).toBe(false)
    expect(over.reason).toMatch(/1 GB/)
  })
  it("notice copy is plain-English with the rounded MB", () => {
    expect(sendAsLinkNotice(26 * MB)).toBe(
      "Your files total 26 MB. Pathway will send these as download links — recipient clicks to download.",
    )
  })
})

describe("threading", () => {
  it("parseMessageIdList extracts angle-bracket ids + falls back to bare tokens", () => {
    expect(parseMessageIdList("<a@x> <b@y>")).toEqual(["<a@x>", "<b@y>"])
    expect(parseMessageIdList("a@x b@y")).toEqual(["a@x", "b@y"])
    expect(parseMessageIdList(null)).toEqual([])
  })
  it("deriveThreadId inherits an existing thread, else roots at self", () => {
    expect(deriveThreadId("<self@x>", "<root@x>")).toBe("<root@x>")
    expect(deriveThreadId("<self@x>", null)).toBe("<self@x>")
  })
  it("groupEmailsByThread groups, sorts oldest-first within, newest-thread-first", () => {
    const mk = (id: string, threadId: string | null, t: string) => ({
      id,
      threadId,
      timestamp: new Date(t),
    })
    const emails = [
      mk("m1", "T1", "2026-06-01T10:00:00Z"),
      mk("m3", "T2", "2026-06-05T10:00:00Z"),
      mk("m2", "T1", "2026-06-02T10:00:00Z"),
      mk("solo", null, "2026-06-03T10:00:00Z"),
    ]
    const groups = groupEmailsByThread(emails)
    // T2 (06-05) newest, then solo (06-03), then T1 (last msg 06-02)
    expect(groups.map((g) => g.threadId)).toEqual(["T2", "solo", "T1"])
    const t1 = groups.find((g) => g.threadId === "T1")
    expect(t1?.messages.map((m) => m.id)).toEqual(["m1", "m2"])
    expect(t1?.root.id).toBe("m1")
    expect(t1?.replyCount).toBe(1)
  })
})
