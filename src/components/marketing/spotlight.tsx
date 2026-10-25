"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";

/** Carte à projecteur : un liseré bleu suit le pointeur. Réimplémentation maison (effet vu sur 21st.dev, code non repris). */
export function Spotlight({ className, children, as: Tag = "div" }: { className?: string; children: React.ReactNode; as?: "div" | "article" }) {
  const onMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);
  return (
    <Tag onPointerMove={onMove} className={cn("mk-spot rounded-xl border bg-card", className)}>
      {children}
    </Tag>
  );
}
