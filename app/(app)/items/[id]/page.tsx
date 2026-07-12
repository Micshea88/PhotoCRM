import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getSession } from "@/modules/auth/session"
import { getItemForOrg } from "@/modules/items/queries"
import { Button } from "@/components/ui/button"
import { DeleteItemButton } from "@/modules/items/ui/delete-item-button"
import { PageContainer } from "@/modules/shared/ui/page-container"

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const item = await getItemForOrg(orgId, id)
  if (!item) notFound()

  return (
    <PageContainer variant="default" className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{item.name}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Status: {item.status}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/items/${item.id}/edit`}>
            <Button variant="outline" size="sm">
              Edit
            </Button>
          </Link>
          <DeleteItemButton id={item.id} redirectTo="/items" />
        </div>
      </div>
      {item.description && (
        <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm whitespace-pre-wrap">
          {item.description}
        </div>
      )}
      <div className="text-xs text-[var(--color-muted-foreground)]">
        Created {item.createdAt.toLocaleString()}
      </div>
    </PageContainer>
  )
}
