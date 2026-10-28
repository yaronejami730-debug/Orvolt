"use client";

import dynamic from "next/dynamic";

export const DAY_COLORS = ["#4f7cff", "#22b573", "#f59e0b", "#c084fc", "#f472b6", "#2dd4bf", "#fb923c"];

/** Carte OpenStreetMap (Leaflet) chargée côté client uniquement. */
export const RouteMap = dynamic(() => import("./route-map"), { ssr: false, loading: () => <div className="h-72 w-full animate-pulse rounded-lg bg-muted sm:h-80 lg:h-96" /> });
export type { MapDay, MapStop } from "./route-map";
