"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

/** Carte OpenStreetMap (Leaflet) pour poser/déplacer un pin. Tuiles chargées à la demande (usage léger), attribution OSM affichée. */
export default function PinMap({ lat, lng, onMove }: { lat: number; lng: number; onMove: (lat: number, lng: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      map = L.map(el.current, { center: [lat, lng], zoom: 13, scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>" }).addTo(map);
      const icon = L.divIcon({ className: "", html: "<div style=\"width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2b59ff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)\"></div>", iconSize: [22, 22], iconAnchor: [11, 22] });
      const marker = L.marker([lat, lng], { draggable: true, icon, keyboard: true, title: "Déplacez le pin sur le lieu du RDV" }).addTo(map);
      marker.on("dragend", () => { const p = marker.getLatLng(); onMoveRef.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))); });
      map.on("click", (e: import("leaflet").LeafletMouseEvent) => { marker.setLatLng(e.latlng); onMoveRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))); });
    })();
    return () => { cancelled = true; map?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={el} className="h-64 w-full rounded-lg border" role="application" aria-label="Carte : cliquez ou déplacez le pin pour fixer la position" data-testid="pin-map" />;
}
