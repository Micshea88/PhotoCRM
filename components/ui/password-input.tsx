"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input, type InputProps } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Password field with a show/hide toggle. Wraps the shared `Input`
 * primitive and toggles its `type` between "password" and "text". The
 * toggle is `type="button"` so it NEVER submits the surrounding form.
 *
 * Forwards the ref to the underlying input so it drops in anywhere an
 * `<Input type="password" {...register(...)} />` was used (react-hook-form
 * needs the ref). Accepts every Input prop except `type`, which it owns.
 */
export type PasswordInputProps = Omit<InputProps, "type">

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false)
    const label = visible ? "Hide password" : "Show password"
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          // Reserve room so the value never sits under the toggle button.
          className={cn("pr-9", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => {
            setVisible((v) => !v)
          }}
          aria-label={label}
          title={label}
          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    )
  },
)
PasswordInput.displayName = "PasswordInput"
