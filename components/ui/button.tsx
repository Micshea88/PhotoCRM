import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // 4e motion: functional, restrained — a 150ms ease-out hover darken + 1px
  // lift (motion-safe only, so prefers-reduced-motion users get no movement),
  // sage focus-visible ring. No shadows — restraint (hairlines/whitespace).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,transform] duration-150 ease-out focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none motion-safe:hover:-translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:brightness-95 active:brightness-95",
        destructive:
          "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:brightness-95 active:brightness-95",
        outline:
          "border border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--state-hover)] hover:text-[var(--color-accent-foreground)] active:bg-[var(--state-active)]",
        secondary:
          "bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] hover:brightness-95 active:brightness-95",
        ghost:
          "hover:bg-[var(--state-hover)] hover:text-[var(--color-accent-foreground)] active:bg-[var(--state-active)]",
        link: "text-[var(--color-primary)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = "Button"

export { buttonVariants }
