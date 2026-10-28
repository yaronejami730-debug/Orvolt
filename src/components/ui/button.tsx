"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/* Boutons GoCardless : pilule 32px, 14px/600, 36px de haut, bordures en box-shadow inset. */
export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-semibold leading-5 transition-[background,color,box-shadow] duration-100 focus-visible:outline-none disabled:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-3",
  {
    variants: {
      variant: {
        /* Encre sur surface. Hover = souligné, fond inchangé. */
        primary: "bg-accent text-accent-foreground hover:underline disabled:bg-accent-soft disabled:text-foreground/38",
        /* Jaune de marque : réservé au CTA de la sidebar. */
        brand: "bg-brand text-brand-foreground hover:bg-brand-hover disabled:bg-foreground/5 disabled:text-foreground/10",
        /* Contour 1px encre. */
        secondary: "bg-transparent text-foreground shadow-[inset_0_0_0_1px_var(--foreground)] hover:bg-accent-soft disabled:text-foreground/38 disabled:shadow-[inset_0_0_0_1px_var(--border)]",
        /* Transparent, fond gris au survol. */
        ghost: "bg-transparent text-foreground hover:bg-accent-soft disabled:text-foreground/38",
        /* Pilule contour gris (filtres). */
        outline: "bg-transparent text-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-foreground/4 disabled:text-foreground/38",
        destructive: "bg-destructive text-destructive-foreground hover:underline disabled:opacity-50",
      },
      size: {
        sm: "h-8 px-4 text-xs leading-4",
        md: "h-9 px-5",
        lg: "h-[46px] px-6 text-base leading-[22px] [&_svg]:size-4",
        icon: "size-9 rounded-xl p-3 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, type = "button", ...props }, ref) => {
    if (asChild) {
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
