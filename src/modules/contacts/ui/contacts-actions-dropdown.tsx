"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
 *   2. Import contacts   → /contacts/import (duplicate of the top-bar
 *                          "Import" button, intentional — HubSpot
 *                          pattern for discoverability when the table
 *                          has scrolled the header off-screen)
 *   3. Restore records   → /contacts/deleted (the existing trash view;
 *                          users restore soft-deleted contacts there)
 *   4. Manage duplicates → disabled + native title="Coming soon"
 *                          (V1.5 feature; placeholder signals the
 *                          slot is planned and won't get repurposed)
 */
export function ContactsActionsDropdown({ onOpenEditColumns }: { onOpenEditColumns: () => void }) {
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
        <DropdownMenuItem asChild>
          <Link href="/contacts/import">Import contacts</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/contacts/deleted">Restore records</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled
          title="Coming soon"
          // Radix disabled also blocks click, but we keep the title
          // attribute so hover-tooltip still hints at intent.
        >
          Manage duplicates
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
