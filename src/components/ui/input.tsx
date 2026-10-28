import * as React from "react";
import { cn } from "@/lib/utils";

/* Champs GoCardless : 38px, rayon 8px, contour inset 1px gris (encre au survol, 2px au focus). */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn("h-[38px] w-full rounded-md border-0 bg-card px-4 text-base leading-[22px] text-foreground shadow-[inset_0_0_0_1px_var(--input)] transition-shadow placeholder:text-muted-foreground hover:shadow-[inset_0_0_0_1px_var(--foreground)] focus-visible:shadow-[inset_0_0_0_2px_var(--foreground)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--destructive)]", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";
