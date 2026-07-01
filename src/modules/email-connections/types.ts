import { z } from "zod"

/** The three V1 connect choices (Mike, answer #5): Gmail + Microsoft featured,
 *  "other" = catch-all IMAP via Nylas hosted auth. */
export const emailProviderChoice = z.enum(["gmail", "microsoft", "other"])
export type EmailProviderChoiceInput = z.infer<typeof emailProviderChoice>

export const beginEmailConnectInput = z.object({
  provider: emailProviderChoice,
})

export const disconnectEmailInput = z.object({})
