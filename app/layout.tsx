import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Open_Sans, Bodoni_Moda } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import { ThemeProvider } from "@/modules/org/ui/theme-provider"
import "./globals.css"

// Body / UI type — Open Sans. Display / headings — Bodoni Moda (serif; italics
// live here). Exposed as CSS variables that the @theme --font-sans / --font-serif
// tokens reference; components only ever reference the semantic tokens.
const fontSans = Open_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-loaded",
})
const fontSerif = Bodoni_Moda({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-serif-loaded",
})

export const metadata: Metadata = {
  title: "Pathway",
  description: "Process management for teams",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontSerif.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground min-h-screen antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
