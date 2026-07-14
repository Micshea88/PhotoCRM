"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Push 2c.2 — top-header Actions dropdown on /contacts.
 *
 * Holds ORG-LEVEL actions only (bulk-row actions moved to the
 * SelectionBanner that appears above the table when 1+ rows are
 * selected — that's the HubSpot Path B pattern).
 *
 * Items, in order:
 *   1. Edit columns      → opens the host's Edit Columns drawer
 *   2. Export (CSV/XLSX) → downloads the current view (active filters +
 *                          visible columns) client-side
 *   3. Import contacts   → /contacts/import (the sole Import entry point;
 *                          the standalone top-bar Import button was removed)
 *   3. Restore records   → /contacts/deleted (the existing trash view;
 *                          users restore soft-deleted contacts there)
 *   4. View archived     → /contacts/archived (separate from deleted;
 *                          archived contacts don't auto-purge — Push
 *                          2c.5 restored this affordance after Push
 *                          2c.2's overflow-menu removal dropped it)
 *   5. Manage duplicates → /contacts/duplicates (Push 4 B1 made
 *                          this live; the detection engine ships in
 *                          B1, merge UI in B2). Owner+Admin only at
 *                          the page level; non-elevated roles still
 *                          see the menu item but the route redirects
 *                          to /dashboard.
 */
export function ContactsActionsDropdown({
  onOpenEditColumns,
  onExport,
}: {
  onOpenEditColumns: () => void
  onExport: (format: "csv" | "xlsx") => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="Actions">
          Actions
          <span aria-hidden="true" className="ml-1">
            ▾
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onOpenEditColumns}>Edit columns</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              onSelect={() => {
                onExport("csv")
              }}
            >
              CSV (.csv)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onExport("xlsx")
              }}
            >
              Excel (.xlsx)
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem asChild>
          <Link href="/contacts/import">Import contacts</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/contacts/deleted">Restore records</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/contacts/archived">View archived</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/contacts/duplicates">Manage duplicates</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
