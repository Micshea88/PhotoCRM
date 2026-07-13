import Link from "next/link"
import { redirect } from "next/navigation"
import { Package } from "lucide-react"
import { getSession } from "@/modules/auth/session"
import { listItemsForOrg } from "@/modules/items/queries"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/modules/shared/ui/page-container"

export default async function ItemsPage() {
  const session = await getSession()
  if (!session?.user) redirect("/sign-in")
  const orgId = session.session.activeOrganizationId
  if (!orgId) redirect("/onboarding/create-organization")

  const items = await listItemsForOrg(orgId)

  return (
    <PageContainer variant="full" className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Items</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Worked-example feature. Copy this module to add new features.
          </p>
        </div>
        <Link href="/items/new">
          <Button>New item</Button>
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Package className="size-6" />}
          title="No items yet"
          description="Create your first item to get started."
          action={
            <Button asChild>
              <Link href="/items/new">New item</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {items.map((item) => (
            <li key={item.id} className="p-4">
              <Link
                href={`/items/${item.id}`}
                className="flex items-center justify-between hover:underline"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">{item.status}</p>
                </div>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {item.createdAt.toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  )
}
