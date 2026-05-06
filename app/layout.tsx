import type { Metadata } from "next"
import type { ReactNode } from "react"
import { ThemeProvider } from "@/modules/org/ui/theme-provider"
import "./globals.css"

export const metadata: Metadata = {
  title: "Pathway",
  description: "Process management for teams",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
