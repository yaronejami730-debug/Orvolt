"use client";

import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { FAQ } from "./faq-data";

export function FaqAccordion({ items = FAQ }: { items?: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const uid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = items.length - 1;
    const target = e.key === "ArrowDown" ? (i === last ? 0 : i + 1) : e.key === "ArrowUp" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (target === null) return;
    e.preventDefault();
    refs.current[target]?.focus();
  };

  return (
    <div className="divide-y border-y">
      {items.map((item, i) => {
        const isOpen = open === i;
        const bid = `${uid}-b${i}`;
        const pid = `${uid}-p${i}`;
        return (
          <div key={item.q}>
            <h3>
              <button
                ref={(el) => { refs.current[i] = el; }}
                id={bid}
                type="button"
                aria-expanded={isOpen}
                aria-controls={pid}
                onClick={() => setOpen(isOpen ? null : i)}
                onKeyDown={(e) => onKey(e, i)}
                className="flex min-h-14 w-full items-center justify-between gap-4 py-5 text-left text-base font-medium focus-visible:outline-offset-4"
              >
                <span>{item.q.replace(" ?", "\u00a0?")}</span>
                <ChevronDown className={cn("size-5 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
              </button>
            </h3>
            {/* Réponse toujours présente dans le HTML (indexable, FAQPage) ; repliée visuellement par une grille 0fr -> 1fr, retirée de l'arbre d'accessibilité tant qu'elle est fermée. */}
            <div className={cn("grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none", isOpen ? "grid-rows-[1fr] visible" : "invisible grid-rows-[0fr]")}>
              <div id={pid} role="region" aria-labelledby={bid} className="overflow-hidden">
                <p className="pb-5 pr-10 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
