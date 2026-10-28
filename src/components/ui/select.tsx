import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Select natif stylé : accessible et mobile-friendly. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn("h-[38px] w-full appearance-none rounded-md border-0 bg-card py-2 pl-4 pr-9 text-base leading-[22px] text-foreground shadow-[inset_0_0_0_1px_var(--input)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--foreground)] focus-visible:shadow-[inset_0_0_0_2px_var(--foreground)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--destructive)]", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-3 -translate-y-1/2 text-foreground" aria-hidden />
    </div>
  ),
);
Select.displayName = "Select";
