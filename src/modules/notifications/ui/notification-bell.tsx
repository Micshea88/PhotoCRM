"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bell } from "lucide-react"
import { cn } from "@/lib/utils"
import { NotificationDropdown } from "./notification-dropdown"

/**
 * Bell icon with unread-count badge. Clicking opens the notification dropdown.
 * Initial count is server-rendered; the count refreshes after any action and
 * when the popover is opened.
 */
export function NotificationBell({ initialUnreadCount }: { initialUnreadCount: number }) {
  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on click-outside + Escape
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (wrapperRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const handleUnreadCountChange = useCallback((count: number) => {
    setUnreadCount(count)
  }, [])

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount)

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
        }}
        aria-label={`Notifications${unreadCount > 0 ? ` (${String(unreadCount)} unread)` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="notification-bell"
        className="relative flex size-8 items-center justify-center rounded-md text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)]/40"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] leading-4 font-bold text-white"
            data-testid="notification-badge"
            aria-hidden
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          className={cn(
            "absolute top-full right-0 z-50 mt-1 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-background)] shadow-lg",
          )}
        >
          <NotificationDropdown
            onUnreadCountChange={handleUnreadCountChange}
            onClose={() => {
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
