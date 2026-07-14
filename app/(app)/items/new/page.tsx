import { redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { ItemForm } from "@/modules/items/ui/item-form"
import { PageContainer } from "@/modules/shared/ui/page-container"

export default async function NewItemPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  if (!session.session.activeOrganizationId) redirect("/onboarding/create-organization")

  return (
    <PageContainer variant="narrow" className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold">New item</h1>
      <ItemForm />
    </PageContainer>
  )
}
