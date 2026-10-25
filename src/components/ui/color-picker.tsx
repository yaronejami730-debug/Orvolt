"use client";

import { Check } from "lucide-react";
import { PALETTE } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function ColorPicker({ value, onChange, label = "Couleur" }: { value: string | null; onChange: (c: string) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-6 gap-2 sm:grid-cols-12">
      {PALETTE.map((c) => {
        const selected = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange(c.value)}
            className={cn(
              "flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-2 focus-visible:outline-ring",
              selected && "ring-2 ring-foreground",
            )}
            style={{ backgroundColor: c.value }}
          >
            {selected && <Check className="size-4 text-white" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
