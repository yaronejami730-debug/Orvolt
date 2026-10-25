"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Suggestion } from "@/lib/geo/resolve";

/**
 * Champ adresse avec autocomplétion (Géoplateforme/BAN via /api/geo/suggest, sans clé), anti-rebond 250 ms,
 * navigable au clavier (flèches, Entrée, Échap) et sur mobile. Le choix d'une suggestion fixe le point GPS une fois pour toutes.
 */
export function AddressField({ id, value, onChange, onPick, placeholder, invalid }: {
  id?: string; value: string; onChange: (v: string) => void; onPick: (s: Suggestion) => void; placeholder?: string; invalid?: boolean;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const [unavailable, setUnavailable] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const search = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) { setItems([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      setBusy(true);
      try {
        const r = await fetch(`/api/geo/suggest?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
        const j = (await r.json()) as { suggestions?: Suggestion[]; unavailable?: boolean };
        if (mine !== seq.current) return;
        setItems(j.suggestions ?? []);
        setUnavailable(!!j.unavailable);
        setOpen(true);
        setActive(-1);
      } catch { if (mine === seq.current) { setItems([]); setUnavailable(true); setOpen(true); } }
      finally { if (mine === seq.current) setBusy(false); }
    }, 250);
  };
  const pick = (s: Suggestion) => { onChange(s.label); onPick(s); setOpen(false); setItems([]); };

  return (
    <div className="relative">
      <Input
        id={inputId} value={value} placeholder={placeholder ?? "Commencez à taper l'adresse…"} autoComplete="off" aria-invalid={invalid ? true : undefined}
        role="combobox" aria-expanded={open} aria-controls={`${inputId}-list`} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${inputId}-opt-${active}` : undefined}
        onChange={(e) => { onChange(e.target.value); search(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && open && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]!); }
          else if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {busy && <Loader2 className="absolute right-3 top-3 size-4 animate-spin text-muted-foreground" aria-hidden />}
      {open && (
        <ul id={`${inputId}-list`} role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md" data-testid="address-suggestions">
          {items.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{unavailable ? "Service d'adresses indisponible : saisissez l'adresse manuellement." : "Aucune adresse trouvée : saisissez-la manuellement."}</li>}
          {items.map((s, i) => (
            <li key={`${s.label}-${i}`} id={`${inputId}-opt-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className={`flex min-h-11 cursor-pointer items-start gap-2 rounded px-3 py-2 text-sm ${i === active ? "bg-muted" : "hover:bg-muted"}`}>
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 break-words">{s.label}{s.precision === "municipality" && <span className="ml-1 text-xs text-warning-text">(commune seule)</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
