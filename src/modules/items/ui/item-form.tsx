"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { createItem, updateItem } from "../actions"
import { createItemInput, type CreateItemFormValues, type CreateItemInput } from "../types"

export function ItemForm({
  initial,
  itemId,
}: {
  initial?: Partial<CreateItemFormValues>
  itemId?: string
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateItemFormValues, unknown, CreateItemInput>({
    resolver: zodResolver(createItemInput),
    defaultValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      status: initial?.status ?? "draft",
    },
  })

  async function onSubmit(values: CreateItemInput) {
    setSubmitting(true)
    setError(null)
    const result = itemId ? await updateItem({ id: itemId, ...values }) : await createItem(values)
    setSubmitting(false)
    if (result.serverError) {
      setError(result.serverError)
      return
    }
    if (result.validationErrors) {
      setError("Please fix the form errors above.")
      return
    }
    router.push("/items")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} />
        {errors.name && (
          <p className="text-xs text-[var(--color-destructive)]">{errors.name.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          rows={4}
          className="block w-full rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
          {...register("description")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          className="h-9 w-full rounded-md border border-[var(--color-input)] bg-transparent px-2 text-sm shadow-sm"
          {...register("status")}
        >
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            router.back()
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : itemId ? "Save changes" : "Create item"}
        </Button>
      </div>
    </form>
  )
}
