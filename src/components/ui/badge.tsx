import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "warning" | "destructive" | "info" | "dark";

/* Tags GoCardless : 12px/14px 600, padding 3px 8px, rayon 6px. */
const tones: Record<Tone, string> = {
  neutral: "bg-muted text-secondary-text",
  accent: "bg-accent-soft text-foreground",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  destructive: "bg-destructive-soft text-destructive-text",
  info: "bg-info-soft text-info-text",
  dark: "bg-foreground text-background text-sm leading-4 px-2 py-1",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Couleur dynamique (ex. couleur d'un statut) : "#22c55e". Prioritaire sur tone. */
  color?: string;
  dot?: boolean;
}

export function Badge({ className, tone = "neutral", color, dot, children, style, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center justify-center gap-1 whitespace-nowrap rounded-sm px-2 py-[3px] text-xs font-semibold leading-[14px]",
        !color && tones[tone],
        className,
      )}
      style={
        color
          ? { color: `color-mix(in srgb, ${color} 72%, var(--foreground))`, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, ...style }
          : style
      }
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
