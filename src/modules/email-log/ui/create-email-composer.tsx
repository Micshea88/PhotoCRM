"use client"

import { useRef, useState, type DragEvent } from "react"
import { useRouter } from "next/navigation"
import { upload } from "@vercel/blob/client"
import { X, Paperclip, Lock } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { checkFileType } from "@/modules/files/file-types"
import {
  routeAttachments,
  sendAsLinkNotice,
  checkFileSize,
  MAX_FILES_PER_EMAIL,
} from "@/modules/email-log/attachment-routing"
import {
  SHARE_LINK_EXPIRATION_OPTIONS,
  DEFAULT_SHARE_LINK_EXPIRATION,
} from "@/modules/files/share-link-core"
import {
  listAttachableFiles,
  resolveUploadedFile,
  pollFileScanState,
} from "@/modules/files/actions"
import { sendContactEmail } from "@/modules/email-log/actions"

/**
 * "Create an email" composer (Commit 3). Real send via Resend through the
 * sendContactEmail action. To/CC/BCC + Subject/Body, attach (Upload new /
 * Choose existing), per-file password + expiration, scan-status polling, and
 * the 25 MB → send-as-link notice. Plain English, photography language.
 */
interface Attachment {
  key: string
  fileId: string | null
  name: string
  sizeBytes: number
  scanStatus: "pending" | "clean" | "infected" | "error"
  heicNotice: boolean
  protect: boolean
  passcode: string
  expiration: string
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function randomPasscode(): string {
  // Client-side CSPRNG (Web Crypto) for the editable passcode preview — never
  // Math.random. The server still hashes (per-salt scrypt) + rate-limits; this
  // value is also re-validatable server-side (6-digit regex on the action).
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String((buf[0] ?? 0) % 1_000_000).padStart(6, "0")
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
function prettySize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
}

export function CreateEmailComposer({
  open,
  onClose,
  contactId,
  contactEmail,
  knownContactEmails = [],
  defaultExpiration = DEFAULT_SHARE_LINK_EXPIRATION,
}: {
  open: boolean
  onClose: () => void
  contactId: string
  contactEmail: string | null
  knownContactEmails?: string[]
  defaultExpiration?: string
}) {
  const router = useRouter()
  const [to, setTo] = useState<string[]>(contactEmail ? [contactEmail] : [])
  const [cc, setCc] = useState<string[]>([])
  const [bcc, setBcc] = useState<string[]>([])
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalBytes = attachments.reduce((s, a) => s + a.sizeBytes, 0)
  const route = routeAttachments(
    attachments.map((a) => a.sizeBytes),
    new TextEncoder().encode(body).length,
  )
  const anyPending = attachments.some((a) => a.scanStatus === "pending")
  const anyInfectedOrError = attachments.some(
    (a) => a.scanStatus === "infected" || a.scanStatus === "error",
  )
  const canSend =
    to.length > 0 && subject.trim().length > 0 && !anyPending && !anyInfectedOrError && !sending

  function patch(key: string, next: Partial<Attachment>) {
    setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, ...next } : a)))
  }

  // V1 has NO draft persistence — Cancel / close / successful Send all DISCARD
  // the in-memory draft (Gmail "Discard", not "Save as draft"). Reset every
  // field to its initial value (To re-prefills with the contact's primary
  // email) so the next open starts clean. Per-attachment password toggles +
  // expiration live inside `attachments`, so clearing the array resets them too.
  function resetState() {
    setTo(contactEmail ? [contactEmail] : [])
    setCc([])
    setBcc([])
    setSubject("")
    setBody("")
    setAttachments([])
    setAttachOpen(false)
    setSending(false)
    setError(null)
    setDragActive(false)
  }

  // Reset BEFORE notifying the parent, so when it re-opens the composer the
  // fields are already blank.
  function handleClose() {
    resetState()
    onClose()
  }

  async function pollScan(key: string, url: string) {
    // Wait for the async onUploadCompleted to insert the file row, then for the
    // malware scan to resolve.
    for (let i = 0; i < 30; i++) {
      await sleep(1500)
      const res = await resolveUploadedFile({ url })
      const file = res.data?.file
      if (file) {
        patch(key, { fileId: file.id, scanStatus: file.scanStatus as Attachment["scanStatus"] })
        if (file.scanStatus !== "pending") return
        // keep polling scan state by id
        for (let j = 0; j < 30; j++) {
          await sleep(1500)
          const s = await pollFileScanState({ id: file.id })
          const st = s.data?.scanStatus
          if (st && st !== "pending") {
            patch(key, { scanStatus: st as Attachment["scanStatus"] })
            return
          }
        }
        return
      }
    }
    patch(key, { scanStatus: "error" })
  }

  async function onUploadFiles(list: FileList) {
    setError(null)
    for (const file of Array.from(list)) {
      if (attachments.length >= MAX_FILES_PER_EMAIL) {
        setError(`You can attach up to ${String(MAX_FILES_PER_EMAIL)} files per email.`)
        break
      }
      const check = checkFileType(file.name)
      if (!check.ok) {
        setError(`${file.name}: ${check.reason ?? "unsupported file"}`)
        continue
      }
      const sizeCheck = checkFileSize(file.size)
      if (!sizeCheck.ok) {
        setError(`${file.name}: ${sizeCheck.reason ?? "file too large"}`)
        continue
      }
      const key = crypto.randomUUID()
      setAttachments((prev) => [
        ...prev,
        {
          key,
          fileId: null,
          name: file.name,
          sizeBytes: file.size,
          scanStatus: "pending",
          heicNotice: !!check.heicNotice,
          protect: false,
          passcode: "",
          expiration: defaultExpiration,
        },
      ])
      try {
        const res = await upload(file.name, file, {
          access: "private",
          handleUploadUrl: "/api/blob/upload",
        })
        void pollScan(key, res.url)
      } catch (err) {
        patch(key, { scanStatus: "error" })
        setError(err instanceof Error ? err.message : "Upload failed")
      }
    }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    if (!dragActive) setDragActive(true)
  }
  function onDragLeave(e: DragEvent) {
    // Only clear when leaving the dropzone itself, not its children.
    if (e.currentTarget === e.target) setDragActive(false)
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files.length > 0) void onUploadFiles(e.dataTransfer.files)
  }

  async function chooseExisting() {
    const res = await listAttachableFiles({})
    const files = res.data?.files ?? []
    // Minimal picker: add any not already attached (the modal lists them below).
    return files
  }

  async function onSend() {
    setSending(true)
    setError(null)
    const res = await sendContactEmail({
      contactId,
      to,
      cc,
      bcc,
      subject: subject.trim(),
      body,
      attachments: attachments
        .filter((a): a is Attachment & { fileId: string } => a.fileId !== null)
        .map((a) => ({
          fileId: a.fileId,
          protect: a.protect,
          password: a.protect && /^\d{6}$/.test(a.passcode) ? a.passcode : undefined,
          expiration: a.expiration,
        })),
    })
    setSending(false)
    if (res.serverError) {
      setError(res.serverError)
      return
    }
    // Success also discards the draft so a later open doesn't show stale data.
    handleClose()
    router.refresh()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create an email" className="max-w-2xl">
      <div
        className={cn(
          "space-y-3 rounded-md text-sm",
          dragActive && "ring-2 ring-[var(--color-ring)] ring-offset-2",
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-testid="email-composer-dropzone"
      >
        {dragActive && (
          <p className="rounded-md border border-dashed border-[var(--color-ring)] bg-[var(--color-muted)] px-3 py-2 text-center text-xs text-[var(--color-muted-foreground)]">
            Drop files to attach
          </p>
        )}
        <EmailChips label="To" emails={to} setEmails={setTo} datalistId="known-emails" />
        <EmailChips label="Cc" emails={cc} setEmails={setCc} datalistId="known-emails" />
        <EmailChips label="Bcc" emails={bcc} setEmails={setBcc} datalistId="known-emails" />
        <datalist id="known-emails">
          {knownContactEmails.map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>

        <Input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value)
          }}
          placeholder="Subject"
          className="h-9"
          spellCheck
          data-testid="email-composer-subject"
        />
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
          }}
          rows={8}
          placeholder="Write your message…"
          spellCheck
          data-testid="email-composer-body"
          className="w-full resize-y rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-ring)] focus:outline-none"
        />

        {/* Attachments */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void onUploadFiles(e.target.files)
                if (fileInputRef.current) fileInputRef.current.value = ""
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setAttachOpen((v) => !v)
              }}
              data-testid="email-composer-attach"
            >
              <Paperclip className="mr-1 size-3.5" aria-hidden="true" /> Attach
            </Button>
            {attachments.length > 0 && (
              <span className="text-xs text-[var(--color-muted-foreground)]">
                {attachments.length} file{attachments.length === 1 ? "" : "s"} ·{" "}
                {prettySize(totalBytes)}
              </span>
            )}
          </div>

          {attachOpen && (
            <div className="rounded-md border border-[var(--color-border)] p-2">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="email-composer-upload-new"
                >
                  Upload new
                </Button>
                <ChooseExistingButton
                  onPick={(f) => {
                    if (attachments.some((a) => a.fileId === f.id)) return
                    if (attachments.length >= MAX_FILES_PER_EMAIL) return
                    setAttachments((prev) => [
                      ...prev,
                      {
                        key: f.id,
                        fileId: f.id,
                        name: f.pathname,
                        sizeBytes: f.sizeBytes,
                        scanStatus: "clean",
                        heicNotice: false,
                        protect: false,
                        passcode: "",
                        expiration: defaultExpiration,
                      },
                    ])
                  }}
                  loadFiles={chooseExisting}
                />
              </div>
            </div>
          )}

          {attachments.map((a) => (
            <AttachmentRow
              key={a.key}
              attachment={a}
              showExpiration={a.protect || route.overLimit}
              onRemove={() => {
                setAttachments((prev) => prev.filter((x) => x.key !== a.key))
              }}
              onToggleProtect={() => {
                patch(a.key, {
                  protect: !a.protect,
                  passcode: !a.protect && !a.passcode ? randomPasscode() : a.passcode,
                })
              }}
              onPasscodeChange={(v) => {
                patch(a.key, { passcode: v })
              }}
              onExpirationChange={(v) => {
                patch(a.key, { expiration: v })
              }}
            />
          ))}

          {route.overLimit && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {sendAsLinkNotice(route.totalBytes)}
            </p>
          )}
        </div>

        {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={sending}
            data-testid="email-composer-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void onSend()}
            disabled={!canSend}
            data-testid="email-composer-send"
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function EmailChips({
  label,
  emails,
  setEmails,
  datalistId,
}: {
  label: string
  emails: string[]
  setEmails: (e: string[]) => void
  datalistId: string
}) {
  const [draft, setDraft] = useState("")
  function commit(raw: string) {
    const e = raw.trim().replace(/,$/, "").trim()
    if (e && EMAIL_RE.test(e) && !emails.includes(e)) setEmails([...emails, e])
    setDraft("")
  }
  return (
    <div className="flex items-start gap-2">
      <span className="mt-2 w-8 shrink-0 text-xs text-[var(--color-muted-foreground)]">
        {label}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-1 rounded-md border border-[var(--color-input)] p-1">
        {emails.map((e) => (
          <span
            key={e}
            className="text-2xs inline-flex items-center gap-1 rounded-full bg-[var(--color-muted)] px-2 py-0.5"
          >
            {e}
            <button
              type="button"
              aria-label={`Remove ${e}`}
              onClick={() => {
                setEmails(emails.filter((x) => x !== e))
              }}
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          list={datalistId}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              commit(draft)
            }
          }}
          onBlur={() => {
            if (draft) commit(draft)
          }}
          placeholder={emails.length === 0 ? "name@email.com" : ""}
          className="min-w-[140px] flex-1 bg-transparent px-1 text-sm focus:outline-none"
          data-testid={`email-composer-${label.toLowerCase()}`}
        />
      </div>
    </div>
  )
}

interface ExistingFile {
  id: string
  pathname: string
  sizeBytes: number
}

function ChooseExistingButton({
  onPick,
  loadFiles,
}: {
  onPick: (f: ExistingFile) => void
  loadFiles: () => Promise<ExistingFile[]>
}) {
  const [openList, setOpenList] = useState(false)
  const [files, setFiles] = useState<ExistingFile[] | null>(null)
  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setOpenList((v) => !v)
          if (files === null) void loadFiles().then(setFiles)
        }}
        data-testid="email-composer-choose-existing"
      >
        Choose existing
      </Button>
      {openList && (
        <div className="absolute z-30 mt-1 max-h-64 w-72 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-1 shadow-md">
          {files === null ? (
            <p className="p-2 text-xs text-[var(--color-muted-foreground)]">Loading…</p>
          ) : files.length === 0 ? (
            <p className="p-2 text-xs text-[var(--color-muted-foreground)]">
              No files ready to attach yet.
            </p>
          ) : (
            files.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onPick(f)
                  setOpenList(false)
                }}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-accent)]/40"
              >
                <span className="truncate">{f.pathname}</span>
                <span className="text-2xs shrink-0 text-[var(--color-muted-foreground)]">
                  {prettySize(f.sizeBytes)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function AttachmentRow({
  attachment,
  showExpiration,
  onRemove,
  onToggleProtect,
  onPasscodeChange,
  onExpirationChange,
}: {
  attachment: Attachment
  showExpiration: boolean
  onRemove: () => void
  onToggleProtect: () => void
  onPasscodeChange: (v: string) => void
  onExpirationChange: (v: string) => void
}) {
  const a = attachment
  const statusLabel =
    a.scanStatus === "pending"
      ? `Scanning ${a.name}…`
      : a.scanStatus === "infected"
        ? "This file contains malware and cannot be uploaded."
        : a.scanStatus === "error"
          ? "We couldn't scan this file. Please try again."
          : "Ready"
  return (
    <div
      className="space-y-1 rounded-md border border-[var(--color-border)] p-2"
      data-testid="attachment-row"
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm">{a.name}</span>
        <span className="text-2xs shrink-0 text-[var(--color-muted-foreground)]">
          {prettySize(a.sizeBytes)}
        </span>
        <button
          type="button"
          onClick={onToggleProtect}
          aria-pressed={a.protect}
          title="Password-protect this file"
          className={cn(
            "rounded p-1",
            a.protect
              ? "text-[var(--color-primary)]"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
          )}
          data-testid="attachment-protect-toggle"
        >
          <Lock className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove attachment"
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <p
        className={cn(
          "text-2xs",
          a.scanStatus === "infected" || a.scanStatus === "error"
            ? "text-[var(--color-destructive)]"
            : "text-[var(--color-muted-foreground)]",
        )}
      >
        {statusLabel}
      </p>
      {a.heicNotice && (
        <p className="text-2xs text-[var(--color-muted-foreground)]">
          HEIC files may not display in all email clients.
        </p>
      )}
      {a.protect && (
        <label className="text-2xs flex items-center gap-2 text-[var(--color-muted-foreground)]">
          Passcode
          <input
            value={a.passcode}
            onChange={(e) => {
              onPasscodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))
            }}
            inputMode="numeric"
            className="w-20 rounded border border-[var(--color-input)] bg-transparent px-2 py-0.5 text-center tracking-widest"
            data-testid="attachment-passcode"
          />
        </label>
      )}
      {showExpiration && (
        <label className="text-2xs flex items-center gap-2 text-[var(--color-muted-foreground)]">
          Link expires
          <select
            value={a.expiration}
            onChange={(e) => {
              onExpirationChange(e.target.value)
            }}
            className="rounded border border-[var(--color-input)] bg-transparent px-1 py-0.5 text-xs"
            data-testid="attachment-expiration"
          >
            {SHARE_LINK_EXPIRATION_OPTIONS.filter((o) => o !== "Custom date…").map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
