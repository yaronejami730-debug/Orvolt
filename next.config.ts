import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// CSP : dynamique (nonce par requête), générée dans src/middleware.ts via src/lib/csp.ts.

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), bluetooth=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

// Domaine canonique : si NEXT_PUBLIC_APP_URL n'est pas en « www. », le « www. » est redirigé en 301 vers lui (pas de contenu dupliqué www / sans www).
const canonicalHost = (() => {
  try { const u = new URL(process.env.NEXT_PUBLIC_APP_URL ?? ""); return u.protocol === "https:" && !u.hostname.startsWith("www.") ? u : null; } catch { return null; }
})();

const nextConfig: NextConfig = {
  // Métadonnées (title, description, Open Graph) toujours dans le <head> : sans cela, Next les diffuse en flux en fin de page
  // pour les navigateurs, et les robots de partage (LinkedIn, Slack, Facebook) ou les outils d'audit peuvent ne pas les voir.
  htmlLimitedBots: /.*/,
  // Dossier de build alterné (NEXT_DIST_DIR) : évite les collisions entre builds/serveurs parallèles.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Envoi de fichiers sur la fiche lead (10 Mo max validés côté serveur).
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async redirects() {
    if (!canonicalHost) return [];
    return [{ source: "/:path*", has: [{ type: "host", value: `www.${canonicalHost.hostname}` }], destination: `${canonicalHost.origin}/:path*`, permanent: true }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages d'acquisition : hors index (en plus de la balise meta robots).
      { source: "/lp/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      // Logo et icônes : affichés dans les e-mails (messageries web), les aperçus de lien et les onglets d'autres sites : CORP ouvert, ce sont des images publiques.
      { source: "/brand/:path*", headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
      { source: "/icon.png", headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
      { source: "/apple-icon.png", headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
      { source: "/opengraph-image", headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] },
    ];
  },
};

export default nextConfig;
