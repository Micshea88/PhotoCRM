"use client"
import { createAuthClient } from "better-auth/react"
import { organizationClient } from "better-auth/client/plugins"
import { env } from "@/lib/env"

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  plugins: [organizationClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient
