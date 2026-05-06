"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const schema = z.object({
  name: z.string().min(2, "Name is required").max(80),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(slugRegex, "Use lowercase letters, numbers, and hyphens only"),
})

type Values = z.infer<typeof schema>

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function CreateOrganizationForm() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, dirtyFields },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  const name = useWatch({ control, name: "name" })

  useEffect(() => {
    if (!name) return
    if (dirtyFields.slug) return
    setValue("slug", slugify(name), { shouldDirty: false })
  }, [name, dirtyFields.slug, setValue])

  async function onSubmit(values: Values) {
    setSubmitting(true)
    setError(null)
    const created = await authClient.organization.create({
      name: values.name,
      slug: values.slug,
    })
    if (created.error) {
      setSubmitting(false)
      setError(created.error.message ?? "Could not create organization")
      return
    }
    await authClient.organization.setActive({ organizationId: created.data.id })
    setSubmitting(false)
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Organization name</Label>
        <Input id="name" {...register("name")} />
        {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="slug">URL slug</Label>
        <Input id="slug" {...register("slug")} />
        {errors.slug && <p className="text-xs text-red-600">{errors.slug.message}</p>}
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Used in URLs and uniquely identifies your org.
        </p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating…" : "Create organization"}
      </Button>
    </form>
  )
}
