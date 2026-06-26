/**
 * CreateEmailComposer — V1 in-memory draft is DISCARDED on Cancel / close /
 * successful Send (Gmail "Discard", not "Save as draft"). These tests lock the
 * reset contract so re-opening the composer never shows a stale draft.
 *
 * The composer eagerly imports server actions whose module graph reaches
 * @/lib/db (top-level env access throws in jsdom), so we mock those modules +
 * the blob client + the router — leaving the pure composer logic under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const { sendContactEmail, upload } = vi.hoisted(() => ({
  sendContactEmail: vi.fn(),
  upload: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@vercel/blob/client", () => ({ upload }))
vi.mock("@/modules/email-log/actions", () => ({ sendContactEmail }))
vi.mock("@/modules/files/actions", () => ({
  listAttachableFiles: vi.fn().mockResolvedValue({ data: { files: [] } }),
  resolveUploadedFile: vi.fn().mockResolvedValue({ data: { file: null } }),
  pollFileScanState: vi.fn().mockResolvedValue({ data: { scanStatus: "clean" } }),
}))

import { CreateEmailComposer } from "@/modules/email-log/ui/create-email-composer"

function renderComposer() {
  const onClose = vi.fn()
  render(
    <CreateEmailComposer open onClose={onClose} contactId="c1" contactEmail="client@example.com" />,
  )
  return { onClose }
}

beforeEach(() => {
  sendContactEmail.mockReset()
  upload.mockReset()
})

describe("CreateEmailComposer draft discard", () => {
  it("Cancel clears subject + body", () => {
    const { onClose } = renderComposer()
    const subject = screen.getByTestId("email-composer-subject")
    const body = screen.getByTestId("email-composer-body")
    fireEvent.change(subject, { target: { value: "test subject" } })
    fireEvent.change(body, { target: { value: "test body" } })
    expect(subject).toHaveValue("test subject")

    fireEvent.click(screen.getByTestId("email-composer-cancel"))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("email-composer-subject")).toHaveValue("")
    expect(screen.getByTestId("email-composer-body")).toHaveValue("")
  })

  it("Cancel clears attachments", async () => {
    // Reject the upload so no async scan-poll runs; the attachment row is still
    // added (then marked error) before Cancel discards it.
    upload.mockRejectedValue(new Error("nope"))
    const { container } = render(
      <CreateEmailComposer
        open
        onClose={vi.fn()}
        contactId="c1"
        contactEmail="client@example.com"
      />,
    )
    const fileInput = container.querySelector('input[type="file"]')
    if (!fileInput) throw new Error("file input not found")
    const file = new File(["data"], "test.pdf", { type: "application/pdf" })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByTestId("attachment-row")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId("email-composer-cancel"))
    expect(screen.queryByTestId("attachment-row")).not.toBeInTheDocument()
  })

  it("successful Send clears all fields", async () => {
    sendContactEmail.mockResolvedValue({ data: { ok: true } })
    const { onClose } = renderComposer()
    fireEvent.change(screen.getByTestId("email-composer-subject"), {
      target: { value: "hello" },
    })

    fireEvent.click(screen.getByTestId("email-composer-send"))

    await waitFor(() => {
      expect(sendContactEmail).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByTestId("email-composer-subject")).toHaveValue("")
    })
    expect(onClose).toHaveBeenCalled()
  })
})
