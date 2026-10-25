import type { Metadata } from "next";
import { FaqSection } from "@/components/marketing/faq-section";
import { FAQ } from "@/components/marketing/faq-data";
import { FeatureDemos } from "@/components/marketing/feature-demos";
import { Hero } from "@/components/marketing/hero";
import { JsonLd } from "@/components/marketing/json-ld";
import { PricingSection } from "@/components/marketing/pricing-section";
import { Features, FinalCta, HowItWorks, Statement, Trades } from "@/components/marketing/sections";
import { PLAN_LIST } from "@/lib/billing/plans";
import { isSignedIn } from "@/lib/marketing-session";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";

const title = "LeadForge, suivez chaque lead de l'appel à la signature";

export const metadata: Metadata = {
  title: { absolute: title },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: SITE_NAME, title, description: SITE_DESCRIPTION, locale: "fr_FR", images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "LeadForge, suivez chaque lead de l'appel à la signature" }] },
  twitter: { card: "summary_large_image", title, description: SITE_DESCRIPTION },
};

export default async function LandingPage() {
  const signedIn = await isSignedIn();
  const base = siteUrl();
  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: SITE_NAME,
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description: SITE_DESCRIPTION,
            url: base,
            inLanguage: "fr-FR",
            offers: PLAN_LIST.map((p) => ({ "@type": "Offer", name: p.name, price: (p.priceCents / 100).toFixed(2), priceCurrency: "EUR", url: `${base}/pricing` })),
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
          },
        ]}
      />
      <Hero signedIn={signedIn} />
      <Statement />
      <Trades />
      <Features />
      <FeatureDemos />
      <HowItWorks />
      <PricingSection signedIn={signedIn} />
      <FaqSection />
      <FinalCta signedIn={signedIn} />
    </>
  );
}
