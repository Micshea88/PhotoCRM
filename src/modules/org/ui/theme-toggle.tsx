"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const current = theme === "system" ? resolvedTheme : theme
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => {
        setTheme(current === "dark" ? "light" : "dark")
      }}
    >
      {current === "dark" ? <Sun /> : <Moon />}
    </Button>
  )
}
