import { z } from "zod"

export const itemStatusSchema = z.enum(["draft", "active", "archived"])

export const createItemInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: itemStatusSchema.default("draft"),
})

export const updateItemInput = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: itemStatusSchema.optional(),
})

export const deleteItemInput = z.object({ id: z.string() })
export const restoreItemInput = z.object({ id: z.string() })

export type CreateItemInput = z.infer<typeof createItemInput>
export type CreateItemFormValues = z.input<typeof createItemInput>
export type UpdateItemInput = z.infer<typeof updateItemInput>
