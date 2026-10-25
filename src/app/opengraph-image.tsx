import { ImageResponse } from "next/og";

export const alt = "LeadForge, suivez chaque lead de l'appel à la signature";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "radial-gradient(ellipse at 20% 0%, #0a2bd6 0%, #05070d 62%)", color: "#f5f7fb", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "#2b59ff", display: "flex" }} />
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>LeadForge</div>
        </div>
        <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.04, marginTop: 48, letterSpacing: -3 }}>Suivez chaque lead de l&apos;appel à la signature.</div>
        <div style={{ fontSize: 30, color: "#8a93a6", marginTop: 28 }}>Le CRM des équipes de terrain. Essai gratuit 14 jours.</div>
      </div>
    ),
    size,
  );
}
