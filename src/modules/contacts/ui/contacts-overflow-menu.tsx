"use client"

import Link from "next/link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

/**
 * The "⋮" menu next to the page actions on /contacts. PUSH 2a ships
 * only the Trash link; PUSH 4 adds bulk operations + import/export.
 */
export function ContactsOverflowMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="More actions">
          ⋮
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/contacts/archived">Archived</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/contacts/deleted">Deleted</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
