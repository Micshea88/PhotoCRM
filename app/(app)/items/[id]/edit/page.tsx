import { notFound, redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { getItemForOrg } from "@/modules/items/queries"
import { ItemForm } from "@/modules/items/ui/item-form"
import { PageContainer } from "@/modules/shared/ui/page-container"

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const item = await getItemForOrg(orgId, id)
  if (!item) notFound()

  return (
    <PageContainer variant="narrow" className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold">Edit item</h1>
      <ItemForm
        itemId={item.id}
        initial={{
          name: item.name,
          description: item.description ?? undefined,
          status: item.status,
        }}
      />
    </PageContainer>
  )
}
