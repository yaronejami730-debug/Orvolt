"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "./route-map.css";

export interface MapStop { id: string; lat: number; lng: number; n: number; kind: "new" | "existing"; title: string }
export interface MapDay { day: string; color: string; stops: MapStop[] }

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Vraie carte OpenStreetMap (Leaflet) : base, tournée du jour (pins numérotés, trajet), cadrage automatique sur les points. */
export default function RouteMap({ base, baseName, days, activeDay, selectedId, onSelect, ariaLabel }: {
  base: { lat: number; lng: number }; baseName: string; days: MapDay[]; activeDay: string | "all"; selectedId: string | null;
  onSelect: (id: string, day: string) => void; ariaLabel: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const state = useRef<{ L: typeof import("leaflet"); map: import("leaflet").Map; layer: import("leaflet").LayerGroup } | null>(null);
  const latest = useRef({ base, baseName, days, activeDay, selectedId, onSelect });
  latest.current = { base, baseName, days, activeDay, selectedId, onSelect };
  const lastFit = useRef("");

  const draw = () => {
    const s = state.current; if (!s) return;
    const { L, map, layer } = s;
    const c = latest.current;
    layer.clearLayers();
    const visible = c.days.filter((d) => c.activeDay === "all" || d.day === c.activeDay);
    const pts: [number, number][] = [[c.base.lat, c.base.lng]];
    // Les autres jours restent visibles en trait très léger pour garder le contexte.
    for (const d of c.days) {
      if (visible.includes(d)) continue;
      const line: [number, number][] = [[c.base.lat, c.base.lng], ...d.stops.map((p) => [p.lat, p.lng] as [number, number])];
      L.polyline(line, { color: d.color, weight: 2, opacity: 0.18, interactive: false }).addTo(layer);
    }
    for (const d of visible) {
      const line: [number, number][] = [[c.base.lat, c.base.lng], ...d.stops.map((p) => [p.lat, p.lng] as [number, number])];
      L.polyline(line, { color: "#fff", weight: 7, opacity: 0.55, interactive: false }).addTo(layer);
      L.polyline(line, { color: d.color, weight: 4, opacity: 0.95, interactive: false }).addTo(layer);
      for (const p of d.stops) {
        pts.push([p.lat, p.lng]);
        const sel = p.id === c.selectedId;
        const icon = L.divIcon({
          className: "", iconSize: [28, 28], iconAnchor: [14, 14],
          html: `<div class="dispatch-pin${p.kind === "existing" ? " is-existing" : ""}${sel ? " is-selected" : ""}" style="width:28px;height:28px;background:${d.color}">${p.n}</div>`,
        });
        const m = L.marker([p.lat, p.lng], { icon, title: p.title, keyboard: true, zIndexOffset: sel ? 1000 : 0 }).addTo(layer);
        m.on("click", () => latest.current.onSelect(p.id, d.day));
      }
    }
    const home = L.divIcon({
      className: "", iconSize: [30, 30], iconAnchor: [15, 15],
      html: `<div class="dispatch-base" title="${c.baseName.replace(/"/g, "")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg></div>`,
    });
    L.marker([c.base.lat, c.base.lng], { icon: home, title: `Base : ${c.baseName}`, zIndexOffset: 500 }).addTo(layer);
    const key = `${c.activeDay}|${pts.length}|${c.days.length}`;
    if (key !== lastFit.current) {
      lastFit.current = key;
      map.invalidateSize();
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [34, 34], maxZoom: 15 });
      else map.setView([c.base.lat, c.base.lng], 13);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default as typeof import("leaflet");
      if (cancelled || !el.current) return;
      const map = L.map(el.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView([latest.current.base.lat, latest.current.base.lng], 11);
      L.tileLayer(TILE_URL, { maxZoom: 18, attribution: "© <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener noreferrer\">OpenStreetMap</a> contributors" }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      state.current = { L, map, layer };
      draw();
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(el.current);
      (map as unknown as { _ro?: ResizeObserver })._ro = ro;
    })();
    return () => { cancelled = true; const s = state.current; if (s) { (s.map as unknown as { _ro?: ResizeObserver })._ro?.disconnect(); s.map.remove(); } state.current = null; lastFit.current = ""; };
  }, []);
  useEffect(() => { draw(); });

  return <div ref={el} className="dispatch-leaflet h-72 w-full rounded-lg border sm:h-80 lg:h-96" role="application" aria-label={ariaLabel} data-testid="dispatch-map" />;
}
