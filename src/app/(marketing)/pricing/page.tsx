import type { Metadata } from "next";
import { FaqSection } from "@/components/marketing/faq-section";
import { PricingSection } from "@/components/marketing/pricing-section";
import { FinalCta } from "@/components/marketing/sections";
import { isSignedIn } from "@/lib/marketing-session";
import { SITE_NAME } from "@/lib/site";

const description = "Starter 9,90 €, Pro 79 €, Business 199 € par mois selon le nombre d'utilisateurs. Essai gratuit 14 jours · annulation en un clic.";

export const metadata: Metadata = {
  title: "Tarifs",
  description,
  alternates: { canonical: "/pricing" },
  openGraph: { type: "website", url: "/pricing", siteName: SITE_NAME, title: "Tarifs · LeadForge", description, locale: "fr_FR", images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "LeadForge, le CRM de leads pensé pour votre métier" }] },
  twitter: { card: "summary_large_image", title: "Tarifs · LeadForge", description },
};

export default async function PricingPage() {
  const signedIn = await isSignedIn();
  return (
    <>
      <PricingSection page signedIn={signedIn} />
      <FaqSection />
      <FinalCta signedIn={signedIn} />
    </>
  );
}
