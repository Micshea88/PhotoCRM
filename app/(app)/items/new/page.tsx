import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { ItemForm } from "@/modules/items/ui/item-form"

export default async function NewItemPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  if (!session.session.activeOrganizationId) redirect("/onboarding/create-organization")

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">New item</h1>
      <ItemForm />
    </div>
  )
}
