"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal"
import { contactLabel } from "../display"
import { formatPhoneDisplay } from "@/lib/format/phone"
import { archiveContact, deleteContact } from "../actions"

export interface ContactRow {
  id: string
  firstName: string
  lastName: string
  primaryEmail: string | null
  primaryPhone: string | null
  contactType: string | null
  lifecycleStatus: string | null
  tags: string[] | null
  companyName: string | null
}

const DELETE_BODY =
  "This contact will be moved to Deleted and automatically purged after 90 days. You can restore it before then on the Deleted page."

/**
 * Client table for /contacts. Rows are clickable: clicking anywhere
 * EXCEPT the trailing ⋮ menu navigates to /contacts/[id]. The menu
 * uses stopPropagation on its trigger so it never triggers row
 * navigation. Edit / Archive / Delete are wired here; Delete opens
 * the DeleteConfirmModal.
 */
export function ContactsTable({ rows }: { rows: ContactRow[] }) {
  const router = useRouter()
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  function onArchive(id: string) {
    void (async () => {
      const result = await archiveContact({ id })
      if (result.serverError) {
        alert(result.serverError)
        return
      }
      router.refresh()
    })()
  }

  async function onDeleteConfirm() {
    if (!deleteTargetId) return
    setBusyDelete(true)
    const result = await deleteContact({ id: deleteTargetId })
    setBusyDelete(false)
    if (result.serverError) {
      alert(result.serverError)
      return
    }
    setDeleteTargetId(null)
    router.refresh()
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-muted)] text-left text-xs text-[var(--color-muted-foreground)]">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Tags</th>
              <th className="w-12 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-t border-[var(--color-border)] hover:bg-[var(--color-accent)]/30"
                onClick={() => {
                  router.push(`/contacts/${row.id}`)
                }}
              >
                <td className="px-4 py-2 font-medium">
                  {contactLabel(
                    {
                      firstName: row.firstName,
                      lastName: row.lastName,
                      primaryEmail: row.primaryEmail,
                    },
                    row.companyName,
                  )}
                </td>
                <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                  {row.primaryEmail ?? ""}
                </td>
                <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                  {formatPhoneDisplay(row.primaryPhone)}
                </td>
                <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                  {row.contactType ?? ""}
                </td>
                <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                  {row.lifecycleStatus ?? ""}
                </td>
                <td className="px-4 py-2 text-[var(--color-muted-foreground)]">
                  {(row.tags ?? []).join(", ")}
                </td>
                <td
                  className="px-2 py-2 text-right"
                  onClick={(e) => {
                    e.stopPropagation()
                  }}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Actions for ${row.firstName} ${row.lastName}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-[var(--color-accent)]"
                    >
                      ⋮
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          router.push(`/contacts/${row.id}/edit`)
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          onArchive(row.id)
                        }}
                      >
                        Archive
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          setDeleteTargetId(row.id)
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DeleteConfirmModal
        open={!!deleteTargetId}
        onClose={() => {
          if (!busyDelete) setDeleteTargetId(null)
        }}
        onConfirm={() => {
          void onDeleteConfirm()
        }}
        body={DELETE_BODY}
        submitting={busyDelete}
      />
    </>
  )
}
