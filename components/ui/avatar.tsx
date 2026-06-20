import Image from "next/image"
import { cn } from "@/lib/utils"

/**
 * Small user avatar — a photo when `image` is present, else an initials
 * circle. Generic primitive (no domain logic) so it's reusable anywhere a
 * member is shown: the task "Assigned to" filter today, members list / owner
 * columns later. `next/image unoptimized` matches the house pattern for
 * possibly-remote user photos (see custom-fields-renderer image case).
 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0] ?? ""
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()
  const last = parts[parts.length - 1] ?? ""
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase()
}

export function Avatar({
  name,
  image,
  size = 20,
  className,
}: {
  name: string
  image?: string | null
  size?: number
  className?: string
}) {
  if (image) {
    return (
      <Image
        src={image}
        alt={name}
        width={size}
        height={size}
        unoptimized
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    )
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)] text-[10px] font-medium text-[var(--color-muted-foreground)]",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}
