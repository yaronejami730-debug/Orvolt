import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const supabaseWs = supabaseUrl.replace(/^http/, "ws");

const csp = [
  "default-src 'self'",
  // Next injecte des scripts inline ; 'unsafe-eval' uniquement en dev (HMR).
  `script-src 'self' 'unsafe-inline' ${isProd ? "" : "'unsafe-eval' "}https://js.stripe.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://api.stripe.com https://*.supabase.co wss://*.supabase.co${isProd ? "" : " ws://localhost:* ws://127.0.0.1:*"}`,
  "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self)" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  // Dossier de build alterné (NEXT_DIST_DIR) : évite les collisions entre builds/serveurs parallèles.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Envoi de fichiers sur la fiche lead (10 Mo max validés côté serveur).
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
