"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Rafraîchit les données serveur de la page (router.refresh) toutes les `everyMs` ms, onglet visible uniquement.
 * Se met en pause quand l'onglet est masqué et rafraîchit aussitôt au retour. `maxMs` borne la durée totale de l'interrogation.
 * `enabled` false : aucune interrogation.
 */
export function usePollRefresh({ everyMs, maxMs, enabled = true }: { everyMs: number; maxMs?: number; enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const started = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (maxMs !== undefined && Date.now() - started > maxMs) { stop(); return; }
      if (document.visibilityState === "visible") router.refresh();
    };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const onVisibility = () => { if (document.visibilityState === "visible" && timer) tick(); };
    timer = setInterval(tick, everyMs);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [enabled, everyMs, maxMs, router]);
}
