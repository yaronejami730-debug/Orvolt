import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "warning" | "destructive";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-accent-soft text-link",
  success: "bg-success/15 text-success-text",
  warning: "bg-warning/15 text-warning-text",
  destructive: "bg-destructive/15 text-destructive-text",
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
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
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
