import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} : CRM pour l'énergie et les équipes de terrain`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  formatDetection: { telephone: false, email: false, address: false },
  // Indexation autorisée par défaut ; les pages privées ou sans valeur SEO la retirent (robots noindex + en-tête X-Robots-Tag).
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "fr_FR" },
  twitter: { card: "summary_large_image" },
  // Vérification Search Console / Bing Webmaster : renseignez ces variables, aucune balise n'est émise sinon.
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || undefined, other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f9fafb" }, { media: "(prefers-color-scheme: dark)", color: "#0f1521" }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce de la CSP (posé par le middleware) : requis par le script inline anti-flash du thème.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="fr" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh antialiased">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
