import { z } from "zod"
import { getEmailProvider } from "./providers"

/** A connect choice is any provider id in the catalog (featured / icon /
 *  catch-all). Validated against the catalog so an unknown id is rejected. */
export const emailProviderChoice = z
  .string()
  .refine((id) => getEmailProvider(id) !== null, { message: "Unknown email provider" })
export type EmailProviderChoiceInput = z.infer<typeof emailProviderChoice>

export const beginEmailConnectInput = z.object({
  provider: emailProviderChoice,
})

export const disconnectEmailInput = z.object({})
